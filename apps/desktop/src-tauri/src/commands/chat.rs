//! Chat session/message CRUD and the streaming `chat_send` command.

use crate::chat_events;
use crate::chat_runtime;
use crate::db::{self, ChatMessage, ChatSession};
use crate::error::AppResult;
use crate::state::SharedState;
use tauri::AppHandle;
use tauri::{Emitter, State};

#[tauri::command]
pub fn chat_backend_descriptors(
    state: State<'_, SharedState>,
) -> AppResult<Vec<crate::chat_backends::BackendDescriptor>> {
    crate::chat_backends::descriptors(&state)
}

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
pub struct ChatSelectionPatch {
    pub backend_id: Option<String>,
    pub model_kind: Option<String>,
    pub model_value: Option<String>,
    pub mode: Option<String>,
}

#[tauri::command]
pub fn chat_update_selection(
    state: State<'_, SharedState>,
    session_id: String,
    expected_revision: u32,
    patch: ChatSelectionPatch,
) -> AppResult<ChatSession> {
    state.ensure_no_operation()?;
    let backend = match patch.backend_id.as_deref() {
        Some(value) => Some(db::BackendId::parse(value)?),
        None => None,
    };
    let model = match patch.model_kind.as_deref() {
        Some(kind) => Some(db::ModelSelection::parse(
            kind,
            patch.model_value.as_deref(),
        )?),
        None => None,
    };
    let current = {
        let conn = state.db.lock();
        db::get_session(&conn, &session_id)?.ok_or_else(|| {
            crate::error::AppError::msg(format!("Session not found: {session_id}"))
        })?
    };
    let desired_backend = backend
        .clone()
        .or(current.backend.clone())
        .or_else(|| {
            current
                .selected_backend_id
                .as_deref()
                .and_then(|value| db::BackendId::parse(value).ok())
        })
        .unwrap_or_else(db::BackendId::nest);
    let desired_model = model
        .clone()
        .unwrap_or_else(|| current.selected_model.clone());
    let desired_mode = patch.mode.as_deref().unwrap_or(&current.mode);
    crate::chat_backends::validate_selection(
        &crate::chat_backends::descriptors(&state)?,
        &desired_backend,
        &desired_model,
        desired_mode,
    )?;
    let conn = state.db.lock();
    db::update_session_selection(
        &conn,
        &session_id,
        expected_revision,
        db::SelectionPatch {
            selected_backend_id: backend,
            selected_model: model,
            mode: patch.mode,
        },
    )
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
    use crate::knowledge_review::ReviewOutcome;
    match crate::knowledge_review::KnowledgeReview::review(&state, &change_id, approve)? {
        ReviewOutcome::Approved => Ok(()),
        ReviewOutcome::Rejected => Ok(()),
        ReviewOutcome::ResolvedExternal => Ok(()),
        ReviewOutcome::RebasedReviewRequired => {
            let _ = app;
            Err(crate::error::AppError::msg(
                "proposal_rebased_review_required: the file changed externally; the proposal was rebased onto the current content. Review the new diff and approve again.",
            ))
        }
        ReviewOutcome::Conflicted => Err(crate::error::AppError::msg(
            "proposal_conflicted: the file changed externally in an overlapping way. Reject this proposal or start a new agent turn.",
        )),
        ReviewOutcome::Failed { code, message } => {
            Err(crate::error::AppError::msg(format!("{code}: {message}")))
        }
    }
}

#[tauri::command]
pub async fn chat_delete_session(
    state: State<'_, SharedState>,
    session_id: String,
) -> AppResult<()> {
    let mut stopped_active_turn = false;
    if let Some(operation) = state.operation_status() {
        if operation.kind == crate::state::OperationKind::ChatTurn && operation.owner == session_id
        {
            state.request_chat_cancel();
            tokio::time::timeout(std::time::Duration::from_secs(15), async {
                while state.operation_status().is_some() {
                    tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                }
            })
            .await
            .map_err(|_| {
                crate::error::AppError::msg(
                    "chat_stop_timeout: the active Claude process did not stop in time",
                )
            })?;
            stopped_active_turn = true;
        } else {
            return Err(crate::error::AppError::msg(format!(
                "operation_busy: another operation is running for {}",
                operation.owner
            )));
        }
    }
    let _slot = state.inner().begin_operation(
        crate::state::OperationKind::DeleteSession,
        session_id.clone(),
    )?;
    if stopped_active_turn {
        crate::vault_reconciliation::reconcile_vault(&state, std::time::Duration::from_secs(30))
            .await?;
    }
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
pub fn chat_list_turn_activities(
    state: State<'_, SharedState>,
    turn_id: String,
) -> AppResult<Vec<db::ToolActivityRow>> {
    let conn = state.db.lock();
    db::list_tool_activities(&conn, &turn_id)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSendRequest {
    pub session_id: String,
    pub expected_revision: u32,
    pub query: String,
    pub focus_paths: Option<Vec<String>>,
    pub protected_paths: Option<Vec<String>>,
    pub stream_event: String,
}

#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, SharedState>,
    request: ChatSendRequest,
) -> AppResult<ChatMessage> {
    let ChatSendRequest {
        session_id,
        expected_revision,
        query,
        focus_paths,
        protected_paths,
        stream_event,
    } = request;
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let focus = focus_paths.unwrap_or_default();
    let app_data_dir = state.app_data_dir.clone();

    let _turn_slot = state
        .inner()
        .begin_operation(crate::state::OperationKind::ChatTurn, session_id.clone())?;

    let existing_session = {
        let conn = state.db.lock();
        db::get_session(&conn, &session_id)?.ok_or_else(|| {
            crate::error::AppError::msg(format!("Session not found: {session_id}"))
        })?
    };

    let selected_backend = existing_session
        .backend
        .clone()
        .or_else(|| {
            existing_session
                .selected_backend_id
                .as_deref()
                .and_then(|value| db::BackendId::parse(value).ok())
        })
        .unwrap_or_else(db::BackendId::nest);
    crate::chat_backends::validate_selection(
        &crate::chat_backends::descriptors(&state)?,
        &selected_backend,
        &existing_session.selected_model,
        &existing_session.mode,
    )?;

    if existing_session.backend.as_ref().map(db::BackendId::as_str) == Some("claude") {
        if existing_session.backend_status == db::ChatBackendStatus::Unresumable {
            return Err(crate::error::AppError::msg(
                "claude_session_unresumable: this Claude conversation can no longer be resumed; start a new chat",
            ));
        }
        if !settings.claude_agent_enabled {
            return Err(crate::error::AppError::msg(
                "claude_disabled: re-enable Claude Agent in Settings to continue this chat",
            ));
        }
        if !crate::commands::claude_connection_proven(&state, &settings) {
            return Err(crate::error::AppError::msg(
                "claude_unavailable: fix the Claude connection in Settings to continue this chat",
            ));
        }
    } else if existing_session.backend.is_none()
        && existing_session.selected_backend_id.as_deref() == Some("claude")
        && settings.claude_agent_enabled
        && !crate::commands::claude_connection_proven(&state, &settings)
    {
        return Err(crate::error::AppError::msg(
            "claude_unavailable: test the Claude connection in Settings before chatting",
        ));
    }

    let prepared = {
        let mut conn = state.db.lock();
        db::begin_chat_turn(&mut conn, &session_id, expected_revision, &query)?
    };
    let session = prepared.session;
    let turn_id = prepared.turn_id.clone();
    let turn_backend = prepared.backend.clone();
    let turn_mode = prepared.mode.clone();

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
        "chat_send session={session_id} backend={:?} model={:?} mode={turn_mode} query_len={} focus={:?}",
        session.backend,
        prepared.requested_model.cli_model_arg(),
        query.len(),
        focus
    );

    let result = match chat_runtime::run_chat(chat_runtime::ChatRunRequest {
        app: app.clone(),
        state: state.inner().clone(),
        app_data_dir,
        settings: settings.clone(),
        session: session.clone(),
        query: query.clone(),
        focus_paths: focus,
        prior_history: prior,
        mode: turn_mode,
        requested_model: prepared.requested_model.clone(),
        protected_paths: protected_paths.unwrap_or_default(),
        stream_event: stream_event.clone(),
        turn_id: turn_id.clone(),
    })
    .await
    {
        Ok(v) => v,
        Err(e) => {
            crate::nest_debug!("chat", "chat_send failed: {e}");
            let cancelled = e.to_string() == "cancelled";
            {
                let conn = state.db.lock();
                let _ = db::finish_chat_turn(
                    &conn,
                    &turn_id,
                    if cancelled { "cancelled" } else { "failed" },
                    None,
                    None,
                    Some(if cancelled {
                        "chat_cancelled"
                    } else {
                        "chat_failed"
                    }),
                    Some(&e.to_string()),
                );
            }
            if cancelled {
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
        "chat_send ok backend={:?} answer_len={} citations={} thinking={}",
        result.backend,
        result.answer.len(),
        result.citations.len(),
        result.thinking.is_some()
    );

    let message = {
        let mut conn = state.db.lock();
        db::commit_assistant_and_finish_turn(
            &mut conn,
            &turn_id,
            &session_id,
            "succeeded",
            result.effective_model.as_deref(),
            db::NewChatMessage {
                role: "assistant",
                content: &result.answer,
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

    if turn_backend.as_str() == "nest" {
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
    }

    Ok(message)
}

#[tauri::command]
pub fn chat_cancel(state: State<'_, SharedState>) -> AppResult<()> {
    state.request_chat_cancel();
    Ok(())
}
