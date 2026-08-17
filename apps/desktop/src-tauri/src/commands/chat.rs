//! Chat session/message CRUD and the streaming `chat_send` command.

use crate::agent;
use crate::chat_events;
use crate::db::{self, ChatMessage, ChatSession};
use crate::error::AppResult;
use crate::indexing;
use crate::state::SharedState;
use tauri::AppHandle;
use tauri::{Emitter, State};

#[tauri::command]
pub fn chat_create_session(
    state: State<'_, SharedState>,
    title: Option<String>,
) -> AppResult<ChatSession> {
    let conn = state.db.lock();
    db::create_session(&conn, title.as_deref().unwrap_or("New chat"))
}

#[tauri::command]
pub fn chat_get_or_create_initial_session(state: State<'_, SharedState>) -> AppResult<ChatSession> {
    let conn = state.db.lock();
    db::get_or_create_initial_session(&conn)
}

#[tauri::command]
pub fn chat_list_sessions(state: State<'_, SharedState>) -> AppResult<Vec<ChatSession>> {
    let conn = state.db.lock();
    db::list_sessions(&conn)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionPatch {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendRequest {
    pub session_id: String,
    pub query: String,
    pub focus_paths: Option<Vec<String>>,
    pub mode: Option<String>,
    pub protected_paths: Option<Vec<String>>,
    pub stream_event: String,
}

#[tauri::command]
pub fn chat_update_session(
    state: State<'_, SharedState>,
    session_id: String,
    patch: ChatSessionPatch,
) -> AppResult<ChatSession> {
    let conn = state.db.lock();
    db::update_session(
        &conn,
        &session_id,
        db::ChatSessionUpdate {
            title: patch.title,
            pinned: patch.pinned,
            archived: patch.archived,
            title_source: None,
            mode: patch.mode,
        },
    )
}

#[tauri::command]
pub fn chat_get_file_change(
    state: State<'_, SharedState>,
    change_id: String,
) -> AppResult<db::ChatFileChangeDetail> {
    let conn = state.db.lock();
    db::get_chat_file_change(&conn, &change_id)
}

#[tauri::command]
pub fn chat_get_pending_file_change(
    state: State<'_, SharedState>,
    path: String,
) -> AppResult<Option<db::ChatFileChangeDetail>> {
    let conn = state.db.lock();
    db::get_pending_chat_file_change_for_path(&conn, &path)
}

#[tauri::command]
pub fn chat_review_file_change(
    app: AppHandle,
    state: State<'_, SharedState>,
    change_id: String,
    approve: bool,
) -> AppResult<()> {
    let change = {
        let conn = state.db.lock();
        db::get_chat_file_change(&conn, &change_id)?
    };
    if change.status != "pending" {
        return Err(crate::error::AppError::msg(
            "File change is no longer pending",
        ));
    }
    if approve {
        let context = crate::agent_tools::AgentToolContext::new(
            state.inner().clone(),
            app,
            String::new(),
            Vec::new(),
        );
        context.apply_change(&change)?;
        let result = {
            let conn = state.db.lock();
            db::set_chat_file_change_status(&conn, &change_id, "approved")
        };
        if let Err(error) = result {
            crate::agent_tools::rollback_changes(
                state.inner(),
                &[db::NewChatFileChange {
                    path: change.path,
                    operation: change.operation,
                    old_content: change.old_content,
                    new_content: change.new_content,
                }],
            );
            return Err(error);
        }
        indexing::schedule(state.inner())?;
    } else {
        let conn = state.db.lock();
        db::set_chat_file_change_status(&conn, &change_id, "rejected")?;
    }
    Ok(())
}

#[tauri::command]
pub fn chat_delete_session(state: State<'_, SharedState>, session_id: String) -> AppResult<()> {
    let conn = state.db.lock();
    db::delete_session(&conn, &session_id)
}

#[tauri::command]
pub fn chat_list_messages(
    state: State<'_, SharedState>,
    session_id: String,
) -> AppResult<Vec<ChatMessage>> {
    let mut messages = {
        let conn = state.db.lock();
        db::list_messages(&conn, &session_id)?
    };
    // Hide citations that point at removed vault files (packs deleted after the reply).
    let vault = state.vault_path();
    for msg in &mut messages {
        if let Some(refs) = msg.citations.as_mut() {
            refs.retain(|c| vault.join(&c.file_path).is_file());
            if refs.is_empty() {
                msg.citations = None;
            }
        }
    }
    Ok(messages)
}

#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, SharedState>,
    request: ChatSendRequest,
) -> AppResult<ChatMessage> {
    let ChatSendRequest {
        session_id,
        query,
        focus_paths,
        mode,
        protected_paths,
        stream_event,
    } = request;
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let focus = focus_paths.unwrap_or_default();
    let mode = mode.unwrap_or_else(|| "ask".into());
    if mode != "ask" && mode != "agent" {
        return Err(crate::error::AppError::msg(
            "Chat mode must be ask or agent",
        ));
    }
    let app_data_dir = state.app_data_dir.clone();

    // Persist the user turn first for durable history / UI refresh.
    {
        let mut conn = state.db.lock();
        db::add_message(
            &mut conn,
            &session_id,
            db::NewChatMessage {
                role: "user",
                content: &query,
                citations: None,
                thinking: None,
                thinking_seconds: None,
                file_changes: &[],
            },
        )?;
    }

    // Build prior turns for the agent, excluding the just-saved user message
    // so `stream_chat(query, …)` does not duplicate it.
    let prior = {
        let conn = state.db.lock();
        let mut msgs = db::list_messages(&conn, &session_id)?;
        if msgs
            .last()
            .map(|m| m.role == "user" && m.content == query)
            .unwrap_or(false)
        {
            msgs.pop();
        }
        crate::chat_history::messages_to_rig_history(&msgs)
    };

    crate::nest_debug!(
        "chat",
        "chat_send session={session_id} query_len={} focus={:?}",
        query.len(),
        focus
    );

    let result = match agent::run_agent_chat(agent::AgentChatRequest {
        app: app.clone(),
        state: state.inner().clone(),
        app_data_dir,
        settings: settings.clone(),
        session_id: session_id.clone(),
        query: query.clone(),
        focus_paths: focus,
        stream_event: stream_event.clone(),
        prior_history: prior,
        mode: mode.clone(),
        protected_paths: protected_paths.unwrap_or_default(),
    })
    .await
    {
        Ok(v) => v,
        Err(e) => {
            crate::nest_debug!("chat", "chat_send failed: {e}");
            // Soft-cancel: user stopped before any tokens arrived.
            if e.to_string() == "cancelled" {
                let _ = app.emit(
                    &stream_event,
                    chat_events::ChatStreamEvent::Done {
                        message_id: String::new(),
                    },
                );
                return Err(e);
            }
            let _ = app.emit(
                &stream_event,
                chat_events::ChatStreamEvent::Error {
                    message: e.to_string(),
                },
            );
            return Err(e);
        }
    };

    crate::nest_debug!(
        "chat",
        "chat_send ok answer_len={} citations={} thinking={}",
        result.answer.len(),
        result.citations.len(),
        result.thinking.is_some()
    );

    let answer = result.answer;

    let message = {
        let mut conn = state.db.lock();
        db::add_message(
            &mut conn,
            &session_id,
            db::NewChatMessage {
                role: "assistant",
                content: &answer,
                citations: Some(&result.citations),
                thinking: result.thinking.as_deref(),
                thinking_seconds: result.thinking_seconds,
                file_changes: &result.file_changes,
            },
        )
    }?;

    let _ = app.emit(
        &stream_event,
        chat_events::ChatStreamEvent::Done {
            message_id: message.id.clone(),
        },
    );

    // Best-effort title naming — do not block returning the assistant message.
    let state_clone = state.inner().clone();
    let sid = session_id.clone();
    let settings_for_title = settings.clone();
    let app_for_title = app.clone();
    tauri::async_runtime::spawn(async move {
        let updated = crate::title::maybe_auto_title_after_reply(
            &settings_for_title,
            &sid,
            || {
                let conn = state_clone.db.lock();
                crate::title::load_session_turns(&conn, &sid)
            },
            |title| {
                let conn = state_clone.db.lock();
                db::set_session_title_llm(&conn, &sid, title)
            },
        )
        .await;
        if let Some(session) = updated {
            let _ = app_for_title.emit("chat-session-updated", session);
        }
    });

    Ok(message)
}

#[tauri::command]
pub fn chat_cancel(state: State<'_, SharedState>) -> AppResult<()> {
    state.request_chat_cancel();
    Ok(())
}
