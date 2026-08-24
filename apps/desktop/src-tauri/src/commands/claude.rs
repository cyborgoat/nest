use crate::claude_cli::{self, ClaudeDetection, ClaudeErrorCode, ProbeOutcome};
use crate::db::{self, ClaudeConnectionReport, ClaudeConnectionStatus};
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use chrono::Utc;
use serde::Deserialize;
use std::time::Duration;
use tauri::State;

const MIN_CONNECTION_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSettingsRequest {
    pub enabled: bool,
    pub cli_path: String,
    pub custom_models: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClaudeDetectionDto {
    #[serde(rename = "configured_path")]
    pub configured_path: String,
    #[serde(rename = "resolved_path")]
    pub resolved_path: String,
    #[serde(rename = "spawn_strategy")]
    pub spawn_strategy: String,
    #[serde(rename = "cli_version")]
    pub cli_version: Option<String>,
}

#[tauri::command]
pub async fn claude_detect_cli(cli_path: Option<String>) -> AppResult<ClaudeDetectionDto> {
    let configured = cli_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from);
    let detections = claude_cli::detect_cli(configured.as_deref())
        .map_err(|error| AppError::msg(error.to_string()))?;
    for detection in &detections {
        match claude_cli::probe_version(detection, claude_cli::PROBE_VERSION_TIMEOUT).await {
            ProbeOutcome::Version(version) => {
                return Ok(ClaudeDetectionDto {
                    configured_path: detection.configured_path.clone(),
                    resolved_path: detection.resolved_path.clone(),
                    spawn_strategy: spawn_strategy_name(&detection.launch_target),
                    cli_version: Some(version),
                });
            }
            ProbeOutcome::Failed(_) => continue,
        }
    }
    Err(AppError::msg(format!(
        "{}: no candidate produced a version",
        ClaudeErrorCode::InvalidCliPath.as_str()
    )))
}

fn spawn_strategy_name(target: &claude_cli::ClaudeLaunchTarget) -> String {
    match target {
        claude_cli::ClaudeLaunchTarget::Executable { .. } => "direct".to_string(),
        claude_cli::ClaudeLaunchTarget::NodeScript { .. } => "node-script".to_string(),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClaudeModelOptionDto {
    #[serde(rename = "model_id")]
    pub model_id: String,
    pub source: String,
}

#[tauri::command]
pub fn claude_model_options(state: State<'_, SharedState>) -> AppResult<Vec<ClaudeModelOptionDto>> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let mut observed = {
        let conn = state.db.lock();
        db::observed_claude_models(&conn, &settings.claude_cli_path)?
    };
    if let Some(memory) = state.claude_connection.lock().as_ref() {
        if memory.status == ClaudeConnectionStatus::Connected
            && memory.matches_configured(&settings.claude_cli_path)
            && !memory.effective_model.trim().is_empty()
        {
            let model = memory.effective_model.trim().to_string();
            if !observed.iter().any(|m| m == &model) {
                observed.insert(0, model);
            }
        }
    }
    Ok(
        db::claude_model_options(&observed, &settings.claude_custom_models)
            .into_iter()
            .map(|option| ClaudeModelOptionDto {
                model_id: option.model_id,
                source: option.source.as_str().to_string(),
            })
            .collect(),
    )
}

#[tauri::command]
pub async fn claude_test_connection(
    state: State<'_, SharedState>,
    cli_path: String,
) -> AppResult<ClaudeConnectionReport> {
    let _slot = state.inner().begin_operation(
        crate::state::OperationKind::ConnectionProbe,
        "claude_test_connection",
    )?;
    let report = test_connection(&cli_path, &state).await;
    *state.claude_connection.lock() = Some(report.clone());
    Ok(report)
}

#[tauri::command]
pub async fn claude_save_settings(
    state: State<'_, SharedState>,
    request: ClaudeSettingsRequest,
) -> AppResult<ClaudeConnectionReport> {
    let _slot = state.inner().begin_operation(
        crate::state::OperationKind::SaveClaudeSettings,
        "claude_settings",
    )?;
    {
        let conn = state.db.lock();
        db::save_claude_settings(
            &conn,
            request.enabled,
            &request.cli_path,
            &request.custom_models,
        )?;
    }
    if !request.enabled {
        *state.claude_connection.lock() = None;
        return Ok(ClaudeConnectionReport {
            status: ClaudeConnectionStatus::Disabled,
            configured_cli_path: request.cli_path.trim().to_string(),
            ..Default::default()
        });
    }
    let mut report = test_connection(&request.cli_path, &state).await;
    if report.status != ClaudeConnectionStatus::Connected {
        tokio::time::sleep(std::time::Duration::from_millis(750)).await;
        report = test_connection(&request.cli_path, &state).await;
    }
    if report.status == ClaudeConnectionStatus::Connected {
        let conn = state.db.lock();
        db::save_claude_connection_report(&conn, &report)?;
    }
    *state.claude_connection.lock() = Some(report.clone());
    Ok(report)
}

#[tauri::command]
pub fn claude_connection_status(
    state: State<'_, SharedState>,
) -> AppResult<ClaudeConnectionReport> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    if !settings.claude_agent_enabled {
        return Ok(ClaudeConnectionReport {
            status: ClaudeConnectionStatus::Disabled,
            configured_cli_path: settings.claude_cli_path.clone(),
            ..Default::default()
        });
    }
    let configured = settings.claude_cli_path.trim();
    if let Some(report) = state.claude_connection.lock().as_ref() {
        if report.matches_configured(configured) {
            return Ok(report.clone());
        }
    }
    let persisted = {
        let conn = state.db.lock();
        db::load_claude_connection_report(&conn)
    };
    if let Some(mut report) = persisted {
        if report.matches_configured(configured) {
            report.status = ClaudeConnectionStatus::LastConnected;
            return Ok(report);
        }
    }
    Ok(unavailable_report(
        configured,
        "Run Test connection in Settings",
    ))
}

pub fn claude_connection_proven(state: &SharedState, settings: &db::AppSettings) -> bool {
    let memory = state.claude_connection.lock().clone();
    let persisted = {
        let conn = state.db.lock();
        db::load_claude_connection_report(&conn)
    };
    db::connection_proven_from(
        settings.claude_agent_enabled,
        &settings.claude_cli_path,
        memory.as_ref(),
        persisted.as_ref(),
    )
}

async fn test_connection(cli_path: &str, state: &SharedState) -> ClaudeConnectionReport {
    let trimmed = cli_path.trim();
    let configured = if trimmed.is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(trimmed))
    };
    let detections = match claude_cli::detect_cli(configured.as_deref()) {
        Ok(detections) => detections,
        Err(error) => return unavailable_report(trimmed, &error.to_string()),
    };

    for detection in &detections {
        match claude_cli::probe_version(detection, claude_cli::PROBE_VERSION_TIMEOUT).await {
            ProbeOutcome::Version(_) => {
                if let Some(report) = minimal_round_trip(detection, trimmed, state).await {
                    return report;
                }
            }
            ProbeOutcome::Failed(_) => continue,
        }
    }
    unavailable_report(trimmed, "no CLI candidate completed the connection test")
}

async fn minimal_round_trip(
    detection: &ClaudeDetection,
    configured_path: &str,
    state: &SharedState,
) -> Option<ClaudeConnectionReport> {
    let temp_dir = std::env::temp_dir();
    let probe_session = uuid::Uuid::new_v4().to_string();
    let outcome =
        claude_cli::probe_connection(detection, &probe_session, &temp_dir, MIN_CONNECTION_TIMEOUT)
            .await;
    match outcome {
        Ok(result) => {
            let probe = crate::connection_probe::run_six_tool_probe(
                state.clone(),
                None,
                Some(configured_path.to_string()),
            )
            .await;
            if !probe.failures.is_empty() {
                return Some(unavailable_report(
                    configured_path,
                    &format!("nest tool probe failed: {}", probe.failures.join("; ")),
                ));
            }
            if !probe.cleanup_warnings.is_empty() {
                return Some(unavailable_report(
                    configured_path,
                    &format!(
                        "nest tool probe left residue: {}",
                        probe.cleanup_warnings.join("; ")
                    ),
                ));
            }
            Some(ClaudeConnectionReport {
                status: ClaudeConnectionStatus::Connected,
                configured_cli_path: configured_path.to_string(),
                resolved_cli_path: result.resolved_path,
                cli_version: result.cli_version,
                effective_model: result.effective_model,
                tested_at: Utc::now().to_rfc3339(),
                message: None,
            })
        }
        Err(message) => Some(unavailable_report(configured_path, &message)),
    }
}

fn unavailable_report(cli_path: &str, message: &str) -> ClaudeConnectionReport {
    ClaudeConnectionReport {
        status: ClaudeConnectionStatus::Unavailable,
        configured_cli_path: cli_path.to_string(),
        message: Some(message.to_string()),
        ..Default::default()
    }
}
