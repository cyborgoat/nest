//! Chat session/message CRUD and the streaming `chat_send` command.

use crate::agent;
use crate::db::{self, ChatMessage, ChatSession};
use crate::error::AppResult;
use crate::llm;
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
        },
    )
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
    session_id: String,
    query: String,
    focus_paths: Option<Vec<String>>,
    stream_event: String,
) -> AppResult<ChatMessage> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let focus = focus_paths.unwrap_or_default();
    let app_data_dir = state.app_data_dir.clone();

    // Persist the user turn first for durable history / UI refresh.
    {
        let conn = state.db.lock();
        db::add_message(&conn, &session_id, "user", &query, None, None, None)?;
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
                    llm::ChatStreamEvent::Done {
                        message_id: String::new(),
                    },
                );
                return Err(e);
            }
            let _ = app.emit(
                &stream_event,
                llm::ChatStreamEvent::Error {
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
        let conn = state.db.lock();
        db::add_message(
            &conn,
            &session_id,
            "assistant",
            &answer,
            Some(&result.citations),
            result.thinking.as_deref(),
            result.thinking_seconds,
        )?
    };

    let _ = app.emit(
        &stream_event,
        llm::ChatStreamEvent::Done {
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
