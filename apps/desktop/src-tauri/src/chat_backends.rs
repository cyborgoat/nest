use crate::db::{self, BackendId, ModelSelection, ModelSelectionKind};
use crate::error::{AppError, AppResult};
use crate::state::SharedState;

#[derive(Debug, Clone, serde::Serialize)]
pub struct BackendDescriptor {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub availability: String,
    pub reason_code: Option<String>,
    pub message: Option<String>,
    pub modes: Vec<ModeDescriptor>,
    pub models: Vec<ModelDescriptor>,
    pub native_tool_profile: String,
    pub knowledge_profile: String,
    pub settings_target: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ModeDescriptor {
    pub id: String,
    pub available: bool,
    pub reason_code: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelDescriptor {
    pub selection: ModelSelection,
    pub label: String,
    pub source: String,
}

pub fn descriptors(state: &SharedState) -> AppResult<Vec<BackendDescriptor>> {
    let (settings, unknown_ids, observed_models, persisted_report) = {
        let conn = state.db.lock();
        let settings = db::get_settings(&conn)?;
        let unknown_ids = db::list_distinct_backend_ids(&conn)?;
        let observed_models = db::observed_claude_models(&conn, &settings.claude_cli_path)?;
        let report = db::load_claude_connection_report(&conn);
        (settings, unknown_ids, observed_models, report)
    };
    let health = crate::vault_reconciliation::load_health(state);
    let mut result = vec![nest_descriptor(
        &settings.chat_model,
        health.reindex_required,
    )];
    result.push(claude_descriptor(
        state,
        &settings,
        &observed_models,
        persisted_report.as_ref(),
    ));
    for id in unknown_ids {
        if id != "nest" && id != "claude" {
            result.push(unavailable_unknown(id));
        }
    }
    Ok(result)
}

pub fn validate_selection(
    descriptors: &[BackendDescriptor],
    backend: &BackendId,
    model: &ModelSelection,
    mode: &str,
) -> AppResult<()> {
    let descriptor = descriptors
        .iter()
        .find(|descriptor| descriptor.id == backend.as_str())
        .ok_or_else(|| AppError::msg(format!("unknown_backend: {}", backend.as_str())))?;
    if !descriptor.enabled || !matches!(descriptor.availability.as_str(), "ready" | "last_verified")
    {
        return Err(AppError::msg(format!(
            "backend_unavailable: {}",
            descriptor.reason_code.as_deref().unwrap_or("unavailable")
        )));
    }
    let mode_descriptor = descriptor
        .modes
        .iter()
        .find(|candidate| candidate.id == mode)
        .ok_or_else(|| AppError::msg(format!("unsupported_chat_mode: {mode}")))?;
    if !mode_descriptor.available {
        return Err(AppError::msg(format!(
            "mode_unavailable: {}",
            mode_descriptor
                .reason_code
                .as_deref()
                .unwrap_or("unavailable")
        )));
    }
    if model.kind == ModelSelectionKind::Explicit
        && !descriptor
            .models
            .iter()
            .any(|candidate| candidate.selection == *model)
    {
        return Err(AppError::msg(
            "model_unavailable: selected model is not offered",
        ));
    }
    Ok(())
}

fn nest_descriptor(chat_model: &str, reindex_required: bool) -> BackendDescriptor {
    let mut models = vec![ModelDescriptor {
        selection: ModelSelection::default(),
        label: if chat_model.trim().is_empty() {
            "Default (API)".to_string()
        } else {
            chat_model.trim().to_string()
        },
        source: "default".to_string(),
    }];
    if !chat_model.trim().is_empty() {
        models.push(ModelDescriptor {
            selection: ModelSelection {
                kind: ModelSelectionKind::Explicit,
                value: Some(chat_model.trim().to_string()),
            },
            label: chat_model.trim().to_string(),
            source: "configured".to_string(),
        });
    }
    BackendDescriptor {
        id: "nest".to_string(),
        label: "Nest Agent".to_string(),
        enabled: true,
        availability: if reindex_required {
            "unavailable".to_string()
        } else {
            "ready".to_string()
        },
        reason_code: reindex_required.then(|| "reindex_required".to_string()),
        message: reindex_required
            .then(|| "Reindex the workspace before using Nest Agent".to_string()),
        modes: vec![
            mode(
                "ask",
                !reindex_required,
                reindex_required.then_some("reindex_required"),
            ),
            mode(
                "agent",
                !reindex_required,
                reindex_required.then_some("reindex_required"),
            ),
        ],
        models,
        native_tool_profile: "nest_managed".to_string(),
        knowledge_profile: if reindex_required {
            "degraded".to_string()
        } else {
            "nest_native".to_string()
        },
        settings_target: Some("general".to_string()),
    }
}

fn claude_descriptor(
    state: &SharedState,
    settings: &db::AppSettings,
    observed_models: &[String],
    persisted_report: Option<&db::ClaudeConnectionReport>,
) -> BackendDescriptor {
    let memory = state.claude_connection.lock().clone();
    let report = memory.as_ref().or(persisted_report);
    let proven = db::connection_proven_from(
        settings.claude_agent_enabled,
        &settings.claude_cli_path,
        memory.as_ref(),
        persisted_report,
    );
    let availability = if proven {
        if memory.is_some() {
            "ready"
        } else {
            "last_verified"
        }
    } else {
        "unavailable"
    };
    let reason = if !settings.claude_agent_enabled {
        Some("disabled")
    } else if settings.claude_cli_path.trim().is_empty() {
        Some("cli_missing")
    } else if !proven {
        Some("connection_unverified")
    } else {
        None
    };
    let default_label = report
        .map(|report| report.effective_model.trim())
        .filter(|model| !model.is_empty())
        .unwrap_or("CLI Default");
    let mut models = vec![ModelDescriptor {
        selection: ModelSelection::default(),
        label: format!("{default_label} (default)"),
        source: "default".to_string(),
    }];
    models.extend(
        db::claude_model_options(observed_models, &settings.claude_custom_models)
            .into_iter()
            .filter(|option| option.source.as_str() != "default")
            .map(|option| ModelDescriptor {
                selection: ModelSelection {
                    kind: ModelSelectionKind::Explicit,
                    value: Some(option.model_id.clone()),
                },
                label: option.model_id,
                source: option.source.as_str().to_string(),
            }),
    );
    BackendDescriptor {
        id: "claude".to_string(),
        label: "Claude".to_string(),
        enabled: settings.claude_agent_enabled,
        availability: availability.to_string(),
        reason_code: reason.map(str::to_string),
        message: report.and_then(|report| report.message.clone()),
        modes: vec![mode("ask", proven, reason), mode("agent", proven, reason)],
        models,
        native_tool_profile: "claude_cli_open".to_string(),
        knowledge_profile: "nest_mcp".to_string(),
        settings_target: Some("claude_agent".to_string()),
    }
}

fn unavailable_unknown(id: String) -> BackendDescriptor {
    BackendDescriptor {
        label: id.clone(),
        id,
        enabled: false,
        availability: "unavailable".to_string(),
        reason_code: Some("unknown_backend".to_string()),
        message: Some("This historical backend is not installed".to_string()),
        modes: vec![
            mode("ask", false, Some("unknown_backend")),
            mode("agent", false, Some("unknown_backend")),
        ],
        models: Vec::new(),
        native_tool_profile: "unknown".to_string(),
        knowledge_profile: "unavailable".to_string(),
        settings_target: None,
    }
}

fn mode(id: &str, available: bool, reason: Option<&str>) -> ModeDescriptor {
    ModeDescriptor {
        id: id.to_string(),
        available,
        reason_code: reason.map(str::to_string),
        message: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> SharedState {
        std::sync::Arc::new(
            crate::state::AppState::new(
                std::env::temp_dir().join(format!("nest-backends-{}", uuid::Uuid::new_v4())),
            )
            .unwrap(),
        )
    }

    #[test]
    fn selection_validation_rejects_unknown_model_and_disabled_mode() {
        let descriptor = BackendDescriptor {
            id: "agent-x".to_string(),
            label: "Agent X".to_string(),
            enabled: true,
            availability: "ready".to_string(),
            reason_code: None,
            message: None,
            modes: vec![mode("ask", false, Some("policy"))],
            models: vec![ModelDescriptor {
                selection: ModelSelection::default(),
                label: "Default".to_string(),
                source: "default".to_string(),
            }],
            native_tool_profile: "test".to_string(),
            knowledge_profile: "test".to_string(),
            settings_target: None,
        };
        let backend = BackendId::new("agent-x").unwrap();
        assert!(validate_selection(
            std::slice::from_ref(&descriptor),
            &backend,
            &ModelSelection::default(),
            "ask"
        )
        .is_err());
        let explicit = ModelSelection {
            kind: ModelSelectionKind::Explicit,
            value: Some("missing".to_string()),
        };
        let mut enabled = descriptor;
        enabled.modes[0].available = true;
        assert!(validate_selection(&[enabled], &backend, &explicit, "ask").is_err());
    }

    #[test]
    fn registry_preserves_unknown_historical_backend_as_unavailable() {
        let state = state();
        {
            let conn = state.db.lock();
            let session = db::create_session(&conn, "historical").unwrap();
            conn.execute(
                "UPDATE chat_sessions SET backend = 'agent-x', selected_backend_id = 'agent-x' WHERE id = ?1",
                rusqlite::params![session.id],
            )
            .unwrap();
        }
        let descriptors = descriptors(&state).unwrap();
        let unknown = descriptors
            .iter()
            .find(|descriptor| descriptor.id == "agent-x")
            .unwrap();
        assert!(!unknown.enabled);
        assert_eq!(unknown.reason_code.as_deref(), Some("unknown_backend"));
    }
}
