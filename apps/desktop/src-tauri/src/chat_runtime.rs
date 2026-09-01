use crate::agent::{AgentChatRequest, AgentChatResult};
use crate::chat_events::ChatStreamEvent;
use crate::claude_cli::{self, ClaudeTurnRequest, TurnEvents, TurnMode};
use crate::db::{self, BackendId, ChatBackendStatus, ChatSession};
use crate::state::SharedState;
use crate::vault;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

pub struct ChatRunRequest {
    pub app: AppHandle,
    pub state: SharedState,
    pub app_data_dir: PathBuf,
    pub settings: db::AppSettings,
    pub session: ChatSession,
    pub query: String,
    pub focus_paths: Vec<String>,
    pub prior_history: Vec<rig::completion::Message>,
    pub mode: String,
    pub requested_model: db::ModelSelection,
    pub protected_paths: Vec<String>,
    pub stream_event: String,
    pub turn_id: String,
}

pub struct ChatRunResult {
    pub answer: String,
    pub citations: Vec<db::Citation>,
    pub thinking: Option<String>,
    pub thinking_seconds: Option<f64>,
    pub file_changes: Vec<db::NewChatFileChange>,
    pub backend: BackendId,
    pub effective_model: Option<String>,
}

pub fn claude_mode_for(session: &ChatSession) -> Option<TurnMode> {
    match (
        session.backend.as_ref().map(BackendId::as_str),
        session.backend_status,
    ) {
        (Some("claude"), ChatBackendStatus::Uninitialized) => Some(TurnMode::NewSession),
        (Some("claude"), ChatBackendStatus::Ready) => Some(TurnMode::Resume),
        _ => None,
    }
}

pub async fn run_chat(request: ChatRunRequest) -> Result<ChatRunResult, crate::error::AppError> {
    match request.session.backend.as_ref().map(BackendId::as_str) {
        Some("nest") => run_nest(request).await,
        Some("claude") => run_claude(request).await,
        Some(other) => Err(crate::error::AppError::msg(format!(
            "unknown_backend: {other} is unavailable"
        ))),
        None => Err(crate::error::AppError::msg(
            "chat_runtime: session backend is not bound",
        )),
    }
}

async fn run_nest(request: ChatRunRequest) -> Result<ChatRunResult, crate::error::AppError> {
    crate::vault_reconciliation::ensure_workspace_healthy(&request.state)?;
    let ChatRunRequest {
        app,
        state,
        app_data_dir,
        settings,
        session,
        query,
        focus_paths,
        prior_history,
        mode,
        protected_paths,
        stream_event,
        ..
    } = request;
    let effective_model = settings.chat_model.clone();
    let result: AgentChatResult = crate::agent::run_agent_chat(AgentChatRequest {
        app,
        state,
        app_data_dir,
        settings,
        session_id: session.id,
        query,
        focus_paths,
        stream_event,
        prior_history,
        mode,
        protected_paths,
    })
    .await?;
    Ok(ChatRunResult {
        answer: result.answer,
        citations: result.citations,
        thinking: result.thinking,
        thinking_seconds: result.thinking_seconds,
        file_changes: result.file_changes,
        backend: BackendId::nest(),
        effective_model: (!effective_model.trim().is_empty()).then_some(effective_model),
    })
}

async fn run_claude(request: ChatRunRequest) -> Result<ChatRunResult, crate::error::AppError> {
    let ChatRunRequest {
        app,
        state,
        settings,
        session,
        query,
        mode,
        focus_paths,
        protected_paths,
        stream_event,
        ..
    } = request;

    let Some(turn_mode) = claude_mode_for(&session) else {
        return Err(crate::error::AppError::msg(
            "Claude session is unresumable; start a new chat",
        ));
    };
    let configured = if settings.claude_cli_path.trim().is_empty() {
        None
    } else {
        Some(PathBuf::from(settings.claude_cli_path.trim()))
    };
    let detections = claude_cli::detect_cli(configured.as_deref())
        .map_err(|error| crate::error::AppError::msg(error.to_string()))?;
    let detection = detections
        .first()
        .ok_or_else(|| crate::error::AppError::msg("claude_cli: no CLI candidate resolved"))?;

    let chat_mode = if mode == "agent" {
        crate::knowledge_workspace::CapabilityMode::Agent
    } else {
        crate::knowledge_workspace::CapabilityMode::Ask
    };

    let vault_root = state.vault_path();
    let session_id = session.id.clone();
    let state_for_init = state.clone();
    let app_token = app.clone();
    let stream_token = stream_event.clone();

    state.ensure_mcp_server().await?;
    let (mcp_server, mcp_config_path) = {
        let mcp = state.mcp.lock();
        let runtime = mcp
            .as_ref()
            .ok_or_else(|| crate::error::AppError::msg("nest_mcp_unavailable"))?;
        let credential = runtime
            .server
            .begin_turn(
                &session_id,
                &request.turn_id,
                chat_mode,
                protected_paths.clone(),
            )
            .map_err(crate::error::AppError::msg)?;
        let sink_app = app.clone();
        let sink_event = stream_event.clone();
        runtime
            .server
            .set_event_sink(Box::new(move |label, target, done| {
                use tauri::Emitter;
                let _ = sink_app.emit(
                    &sink_event,
                    ChatStreamEvent::ToolActivity {
                        label: label.to_string(),
                        target: target.map(str::to_string),
                        done,
                    },
                );
            }));
        let config_path =
            std::env::temp_dir().join(format!("nest-mcp-{}.json", uuid::Uuid::new_v4().simple()));
        std::fs::write(&config_path, runtime.handle.config_json(&credential))?;
        (runtime.server.clone(), config_path)
    };

    let app_thinking = app.clone();
    let stream_thinking = stream_event.clone();
    let app_tool = app.clone();
    let stream_tool = stream_event.clone();
    let server_for_tools = mcp_server.clone();
    let events = TurnEvents {
        token: Box::new(move |text| {
            let _ = app_token.emit(
                &stream_token,
                ChatStreamEvent::Token {
                    content: text.to_string(),
                },
            );
        }),
        thinking: Box::new(move |text| {
            let _ = app_thinking.emit(
                &stream_thinking,
                ChatStreamEvent::Thinking {
                    content: text.to_string(),
                },
            );
        }),
        tool: Box::new(move |name, target, done| {
            if done {
                let _ = app_tool.emit(
                    &stream_tool,
                    ChatStreamEvent::ToolActivity {
                        label: String::new(),
                        target: None,
                        done: true,
                    },
                );
                return;
            }
            if name.starts_with("mcp__nest__") {
                return;
            }
            let _ = app_tool.emit(
                &stream_tool,
                ChatStreamEvent::ToolActivity {
                    label: name.to_string(),
                    target: target.map(str::to_string),
                    done: false,
                },
            );
            server_for_tools.record_non_nest_activity(name, target);
        }),
        initialized: Box::new(move |session_id, _model, _version| {
            let conn = state_for_init.db.lock();
            db::set_session_backend_status(&conn, session_id, ChatBackendStatus::Ready)
                .map_err(|error| error.to_string())
                .map(|_| ())
        }),
    };

    let knowledge_available = !crate::vault_reconciliation::load_health(&state).reindex_required;
    let instructions = nest_system_instructions(chat_mode, knowledge_available);
    let composed_prompt = compose_focus_prompt(&query, &focus_paths, &vault_root);
    let turn_request = ClaudeTurnRequest {
        vault_root: &vault_root,
        session_id: &session_id,
        mode: turn_mode,
        prompt: &composed_prompt,
        model: request.requested_model.cli_model_arg(),
        chat_mode,
        mcp_config_path: Some(mcp_config_path.as_path()),
        system_instructions: Some(&instructions),
    };
    let cancel = state.begin_chat_cancel_arc();
    let custom_args = claude_cli::parse_custom_args(&settings.claude_custom_args)?;
    let result = match claude_cli::run_turn_with_custom_args(
        detection,
        turn_request,
        &events,
        &cancel,
        &custom_args,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_file(&mcp_config_path);
            mcp_server.abort_staged();
            mcp_server.end_turn();
            mcp_server.clear_event_sink();
            {
                let conn = state.db.lock();
                let _ = db::finalize_running_tool_activities(&conn, &request.turn_id, "failed");
            }
            if let Err(reconcile_error) = crate::vault_reconciliation::reconcile_vault(
                &state,
                std::time::Duration::from_secs(300),
            )
            .await
            {
                let warning = format!("workspace_reconciliation_failed: {reconcile_error}");
                let conn = state.db.lock();
                let _ = db::set_chat_turn_warnings(&conn, &request.turn_id, &[warning]);
            }
            let mapped = map_turn_error(&error);
            if is_unresumable_failure(&error) {
                let updated = {
                    let conn = state.db.lock();
                    db::set_session_backend_status(
                        &conn,
                        &session_id,
                        ChatBackendStatus::Unresumable,
                    )?
                };
                let _ = app.emit("chat-session-updated", updated);
            }
            if is_connection_failure(&error) {
                *state.claude_connection.lock() = Some(db::ClaudeConnectionReport {
                    status: db::ClaudeConnectionStatus::Unavailable,
                    configured_cli_path: settings.claude_cli_path.trim().to_string(),
                    message: Some(mapped.to_string()),
                    ..Default::default()
                });
            }
            return Err(mapped);
        }
    };

    let file_changes = match mcp_server.finish_staged() {
        Ok(changes) => changes,
        Err(error) => {
            mcp_server.abort_staged();
            mcp_server.end_turn();
            mcp_server.clear_event_sink();
            let _ = std::fs::remove_file(&mcp_config_path);
            {
                let conn = state.db.lock();
                let _ = db::finalize_running_tool_activities(&conn, &request.turn_id, "failed");
            }
            return Err(crate::error::AppError::msg(format!(
                "claude_proposal_failed: staged changes could not be finalized; {error}"
            )));
        }
    };
    let citations = mcp_server.take_citations();
    if !citations.is_empty() {
        let _ = app.emit(
            &stream_event,
            ChatStreamEvent::Citations {
                citations: citations.clone(),
            },
        );
    }
    mcp_server.end_turn();
    mcp_server.clear_event_sink();
    let _ = std::fs::remove_file(&mcp_config_path);
    {
        let conn = state.db.lock();
        let _ = db::finalize_running_tool_activities(&conn, &request.turn_id, "succeeded");
    }
    if let Err(reconcile_error) =
        crate::vault_reconciliation::reconcile_vault(&state, std::time::Duration::from_secs(300))
            .await
    {
        let warning = format!("workspace_reconciliation_failed: {reconcile_error}");
        let conn = state.db.lock();
        let _ = db::set_chat_turn_warnings(&conn, &request.turn_id, &[warning]);
    }

    Ok(ChatRunResult {
        answer: result.answer,
        citations,
        thinking: (!result.thinking.trim().is_empty()).then_some(result.thinking),
        thinking_seconds: None,
        file_changes,
        backend: BackendId::claude(),
        effective_model: result.model,
    })
}

pub fn compose_focus_prompt(query: &str, focus_paths: &[String], vault_root: &Path) -> String {
    if focus_paths.is_empty() {
        return query.to_string();
    }
    const MAX_FOCUS_FILES: usize = 16;
    const MAX_FOCUS_CHARS_PER_FILE: usize = 6_000;
    const MAX_FOCUS_CHARS_TOTAL: usize = 48_000;
    let mut section = String::from("\n\n---\nExplicitly selected vault content:");
    let mut total = 0usize;
    for path in focus_paths.iter().take(MAX_FOCUS_FILES) {
        if total >= MAX_FOCUS_CHARS_TOTAL {
            section.push_str(&format!("\n[additional focus files omitted: {}]", path));
            continue;
        }
        match vault::read_file(vault_root, path) {
            Ok(content) => {
                let clipped: String = content
                    .chars()
                    .take(MAX_FOCUS_CHARS_PER_FILE.min(MAX_FOCUS_CHARS_TOTAL - total))
                    .collect();
                let truncated = clipped.chars().count() < content.chars().count()
                    && section.len() < total + MAX_FOCUS_CHARS_TOTAL;
                section.push_str(&format!("\n\n### {path}\n{}", clipped));
                if truncated {
                    section.push_str("\n[truncated]");
                }
                total += clipped.chars().count();
            }
            Err(_) => {
                section.push_str(&format!("\n\n### {path}\n[focus file could not be read]"));
            }
        }
    }
    if focus_paths.len() > MAX_FOCUS_FILES {
        section.push_str(&format!(
            "\n[{} additional focus files omitted]",
            focus_paths.len() - MAX_FOCUS_FILES
        ));
    }
    format!("{query}{section}")
}

pub fn tool_kind_for(name: &str) -> &'static str {
    match name.trim_start_matches("mcp__nest__") {
        "knowledge_search" => "knowledge_search",
        "knowledge_list" => "knowledge_list",
        "knowledge_read" => "knowledge_read",
        "knowledge_create" => "knowledge_stage",
        "knowledge_replace" => "knowledge_stage",
        "knowledge_delete" => "knowledge_stage",
        _ => "external_tool",
    }
}

pub fn tool_source_for(name: &str) -> &'static str {
    if name.starts_with("mcp__nest__") {
        "nest_mcp"
    } else if name.starts_with("mcp__") {
        "external_mcp"
    } else {
        "claude_native"
    }
}

pub fn nest_system_instructions(
    mode: crate::knowledge_workspace::CapabilityMode,
    knowledge_available: bool,
) -> String {
    if !knowledge_available {
        return "Nest knowledge integration:\nNest Knowledge is temporarily unavailable until workspace reindex completes. Continue with Claude native tools or external MCP tools; do not claim Nest citations or reviewable proposals are available.".to_string();
    }
    let mode_line = match mode {
        crate::knowledge_workspace::CapabilityMode::Ask => "You are in Ask mode: read-only. Use only the read-only Nest tools (knowledge_search, knowledge_list, knowledge_read) plus your built-in read-only tools.",
        crate::knowledge_workspace::CapabilityMode::Agent => "You are in Agent mode. You may use all six Nest knowledge tools (knowledge_search, knowledge_list, knowledge_read, knowledge_create, knowledge_replace, knowledge_delete).",
    };
    format!(
        "Nest knowledge integration:\n\
        {mode_line}\n\
        Nest-first routing preference:\n\
        1. For searching and reading Markdown in active knowledge packs, prefer the Nest tools (knowledge_search, knowledge_read, knowledge_list) over generic file reads. They return verifiable, citable sources.\n\
        2. For Markdown changes inside active packs, prefer knowledge_create/knowledge_replace/knowledge_delete. Changes made through these tools are staged as reviewable proposals — nothing is written to disk until the user approves.\n\
        3. Fall back to your native file tools (Read/Edit/Write/Bash) only when the user explicitly asks for a direct change, or when a task cannot be expressed through the Nest tools. Native changes are NOT staged and NOT reviewable — never claim a native file edit has been reviewed or approved by Nest.\n\
        4. Cite sources using the paths returned by the Nest tools, not paths you guess."
    )
}

pub fn is_unresumable_failure(error: &claude_cli::ClaudeTurnError) -> bool {
    matches!(
        error,
        claude_cli::ClaudeTurnError::Process {
            no_conversation: true,
            ..
        }
    ) || matches!(
        error,
        claude_cli::ClaudeTurnError::Protocol { message } if message.contains("not resumable")
    )
}

pub fn is_connection_failure(error: &claude_cli::ClaudeTurnError) -> bool {
    matches!(
        error,
        claude_cli::ClaudeTurnError::SpawnFailed { .. }
            | claude_cli::ClaudeTurnError::Io { .. }
            | claude_cli::ClaudeTurnError::Process { .. }
    )
}

fn map_turn_error(error: &claude_cli::ClaudeTurnError) -> crate::error::AppError {
    match error {
        claude_cli::ClaudeTurnError::Cancelled => crate::error::AppError::msg("cancelled"),
        claude_cli::ClaudeTurnError::SpawnFailed { message } => {
            crate::error::AppError::msg(format!("claude_process_failed: {message}"))
        }
        claude_cli::ClaudeTurnError::Io { message } => {
            crate::error::AppError::msg(format!("claude_process_failed: {message}"))
        }
        claude_cli::ClaudeTurnError::InitPersist { message } => {
            crate::error::AppError::msg(format!("claude_process_failed: {message}"))
        }
        claude_cli::ClaudeTurnError::Protocol { message } => {
            crate::error::AppError::msg(format!("claude_protocol_error: {message}"))
        }
        claude_cli::ClaudeTurnError::SessionMismatch { message } => {
            crate::error::AppError::msg(format!("claude_session_mismatch: {message}"))
        }
        claude_cli::ClaudeTurnError::Process { stderr_tail, .. } => {
            let tail = if stderr_tail.is_empty() {
                String::new()
            } else {
                format!(
                    " | stderr: {}",
                    stderr_tail.chars().take(200).collect::<String>()
                )
            };
            crate::error::AppError::msg(format!("claude_process_failed{tail}"))
        }
        claude_cli::ClaudeTurnError::CliError {
            code,
            subtype,
            sanitized_result,
            ..
        } => {
            let detail = match (subtype.as_str(), sanitized_result.as_deref()) {
                ("", None) => String::new(),
                ("", Some(text)) => format!(": {text}"),
                (subtype, None) => format!(": {subtype}"),
                (subtype, Some(text)) => format!(": {subtype}: {text}"),
            };
            crate::error::AppError::msg(format!("{code}{detail}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_mode_follows_backend_status() {
        let uninitialized = db::ChatSession {
            backend: Some(BackendId::claude()),
            backend_status: ChatBackendStatus::Uninitialized,
            ..test_session()
        };
        assert_eq!(claude_mode_for(&uninitialized), Some(TurnMode::NewSession));
        let ready = db::ChatSession {
            backend: Some(BackendId::claude()),
            backend_status: ChatBackendStatus::Ready,
            ..test_session()
        };
        assert_eq!(claude_mode_for(&ready), Some(TurnMode::Resume));
        let unresumable = db::ChatSession {
            backend: Some(BackendId::claude()),
            backend_status: ChatBackendStatus::Unresumable,
            ..test_session()
        };
        assert_eq!(claude_mode_for(&unresumable), None);
        let nest = db::ChatSession {
            backend: Some(BackendId::nest()),
            backend_status: ChatBackendStatus::Ready,
            ..test_session()
        };
        assert_eq!(claude_mode_for(&nest), None);
        let unbound = db::ChatSession {
            backend: None,
            backend_status: ChatBackendStatus::Uninitialized,
            ..test_session()
        };
        assert_eq!(claude_mode_for(&unbound), None);
    }

    #[test]
    fn turn_errors_map_to_stable_error_codes() {
        let error = map_turn_error(&claude_cli::ClaudeTurnError::Cancelled);
        assert_eq!(error.to_string(), "cancelled");
        let error = map_turn_error(&claude_cli::ClaudeTurnError::Protocol {
            message: "bad stream".to_string(),
        });
        assert_eq!(error.to_string(), "claude_protocol_error: bad stream");
        let error = map_turn_error(&claude_cli::ClaudeTurnError::Process {
            stderr_tail: "x".repeat(600),
            id_in_use: false,
            no_conversation: false,
            saw_init: false,
        });
        let text = error.to_string();
        assert!(text.starts_with("claude_process_failed | stderr: "));
        assert!(text.chars().count() < 260);
        let error = map_turn_error(&claude_cli::ClaudeTurnError::CliError {
            code: claude_cli::ClaudeErrorCode::Protocol,
            subtype: "error_during_execution".to_string(),
            sanitized_result: Some("boom".to_string()),
            exit_ok: true,
        });
        assert_eq!(
            error.to_string(),
            "claude_protocol_error: error_during_execution: boom"
        );
    }

    #[test]
    fn no_conversation_and_fallback_contradiction_mark_unresumable() {
        let no_conversation = claude_cli::ClaudeTurnError::Process {
            stderr_tail: "No conversation found with session ID: x".to_string(),
            id_in_use: false,
            no_conversation: true,
            saw_init: true,
        };
        assert!(is_unresumable_failure(&no_conversation));
        let contradiction = claude_cli::ClaudeTurnError::Protocol {
            message: "session id is in use but not resumable".to_string(),
        };
        assert!(is_unresumable_failure(&contradiction));
        let id_in_use = claude_cli::ClaudeTurnError::Process {
            stderr_tail: "Error: Session ID x is already in use.".to_string(),
            id_in_use: true,
            no_conversation: false,
            saw_init: false,
        };
        assert!(!is_unresumable_failure(&id_in_use));
        assert!(!is_unresumable_failure(
            &claude_cli::ClaudeTurnError::Cancelled
        ));
        assert!(!is_unresumable_failure(
            &claude_cli::ClaudeTurnError::Protocol {
                message: "other protocol issue".to_string(),
            }
        ));
    }

    #[test]
    fn process_level_failures_invalidate_the_connection() {
        assert!(is_connection_failure(
            &claude_cli::ClaudeTurnError::SpawnFailed {
                message: "nope".to_string()
            }
        ));
        assert!(is_connection_failure(&claude_cli::ClaudeTurnError::Io {
            message: "pipe".to_string()
        }));
        assert!(is_connection_failure(
            &claude_cli::ClaudeTurnError::Process {
                stderr_tail: String::new(),
                id_in_use: false,
                no_conversation: false,
                saw_init: false,
            }
        ));
        assert!(!is_connection_failure(
            &claude_cli::ClaudeTurnError::Cancelled
        ));
        assert!(!is_connection_failure(
            &claude_cli::ClaudeTurnError::Protocol {
                message: "bad stream".to_string()
            }
        ));
        assert!(!is_connection_failure(
            &claude_cli::ClaudeTurnError::CliError {
                code: claude_cli::ClaudeErrorCode::Protocol,
                subtype: "error_during_execution".to_string(),
                sanitized_result: None,
                exit_ok: true,
            }
        ));
    }

    #[test]
    fn tool_source_distinguishes_external_mcp_from_native_tools() {
        assert_eq!(tool_source_for("Bash"), "claude_native");
        assert_eq!(tool_source_for("mcp__github__search_code"), "external_mcp");
        assert_eq!(tool_source_for("mcp__nest__knowledge_read"), "nest_mcp");
    }

    fn test_session() -> db::ChatSession {
        db::ChatSession {
            id: "11111111-2222-4333-8444-555555555555".to_string(),
            title: "Test".to_string(),
            pinned: false,
            archived: false,
            title_source: "placeholder".to_string(),
            mode: "ask".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            backend: None,
            backend_status: ChatBackendStatus::Uninitialized,
            selected_backend_id: Some("nest".to_string()),
            selected_model: db::ModelSelection::default(),
            selection_revision: 0,
        }
    }
}
