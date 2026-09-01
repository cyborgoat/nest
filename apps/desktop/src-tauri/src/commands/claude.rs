use crate::claude_cli::{self, ClaudeDetection, ClaudeErrorCode, ProbeOutcome};
use crate::db::{self, ClaudeConnectionReport, ClaudeConnectionStatus};
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use chrono::Utc;
use serde::Deserialize;
use std::time::Duration;
use tauri::State;

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
    let (settings, statuses) = {
        let conn = state.db.lock();
        (
            db::get_settings(&conn)?,
            db::load_claude_model_statuses(&conn)?,
        )
    };
    Ok(db::claude_model_options(&settings.claude_custom_models)
        .into_iter()
        .filter(|option| {
            !db::model_status_for_configured_path(
                &statuses,
                &settings.claude_cli_path,
                &option.model_id,
            )
            .is_some_and(|entry| !entry.ok)
        })
        .map(|option| ClaudeModelOptionDto {
            model_id: option.model_id,
            source: option.source.as_str().to_string(),
        })
        .collect())
}

#[tauri::command]
pub fn claude_model_statuses(
    state: State<'_, SharedState>,
    cli_path: String,
) -> AppResult<std::collections::HashMap<String, db::ClaudeModelStatusEntry>> {
    let conn = state.db.lock();
    let statuses = db::load_claude_model_statuses(&conn)?;
    Ok(db::model_statuses_for_configured_path(&statuses, &cli_path))
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
    let report = test_connection(&cli_path, None, &state).await;
    *state.claude_connection.lock() = Some(report.clone());
    Ok(report)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClaudeModelTestResult {
    pub model: String,
    pub ok: bool,
    pub message: Option<String>,
    pub effective_model: Option<String>,
}

#[tauri::command]
pub async fn claude_test_model(
    state: State<'_, SharedState>,
    cli_path: String,
    model: String,
) -> AppResult<ClaudeModelTestResult> {
    let trimmed_model = model.trim().to_string();
    if trimmed_model.is_empty() {
        return Ok(ClaudeModelTestResult {
            model: trimmed_model,
            ok: false,
            message: Some("model id is empty".to_string()),
            effective_model: None,
        });
    }
    let _slot = state.inner().begin_operation(
        crate::state::OperationKind::ConnectionProbe,
        "claude_test_model",
    )?;
    let report = test_connection(&cli_path, Some(&trimmed_model), &state).await;
    let message = report
        .message
        .as_deref()
        .map(shorten_probe_failure)
        .map(|value| value.to_string());
    let result = ClaudeModelTestResult {
        ok: report.status == ClaudeConnectionStatus::Connected,
        message,
        effective_model: (!report.effective_model.trim().is_empty())
            .then(|| report.effective_model.trim().to_string()),
        model: trimmed_model.clone(),
    };
    {
        let conn = state.db.lock();
        db::upsert_claude_model_status(
            &conn,
            &trimmed_model,
            &db::ClaudeModelStatusEntry {
                configured_cli_path: Some(report.configured_cli_path.clone()),
                ok: result.ok,
                message: result.message.clone(),
                tested_at: Utc::now().to_rfc3339(),
            },
        )?;
    }
    Ok(result)
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
        let mut report = ClaudeConnectionReport {
            status: ClaudeConnectionStatus::Disabled,
            configured_cli_path: request.cli_path.trim().to_string(),
            ..Default::default()
        };
        {
            let conn = state.db.lock();
            if let Some(last) = db::load_claude_connection_report(&conn)
                .filter(|last| last.matches_configured(&request.cli_path))
            {
                report.effective_model = last.effective_model.clone();
            }
        }
        return Ok(report);
    }
    let trimmed = request.cli_path.trim().to_string();
    let proven = {
        let memory = state.claude_connection.lock().clone();
        let persisted = {
            let conn = state.db.lock();
            db::load_claude_connection_report(&conn)
        };
        memory
            .filter(|report| {
                report.status == ClaudeConnectionStatus::Connected
                    && report.matches_configured(&trimmed)
            })
            .or_else(|| {
                persisted.filter(|report| {
                    report.status == ClaudeConnectionStatus::Connected
                        && report.matches_configured(&trimmed)
                })
            })
    };
    let report = match proven {
        Some(report) => {
            {
                let conn = state.db.lock();
                db::save_claude_connection_report(&conn, &report)?;
            }
            report
        }
        None => {
            let mut report = test_connection(&request.cli_path, None, &state).await;
            if report.status != ClaudeConnectionStatus::Connected {
                tokio::time::sleep(Duration::from_millis(750)).await;
                report = test_connection(&request.cli_path, None, &state).await;
            }
            if report.status == ClaudeConnectionStatus::Connected {
                let conn = state.db.lock();
                db::save_claude_connection_report(&conn, &report)?;
            }
            report
        }
    };
    *state.claude_connection.lock() = Some(report.clone());
    Ok(report)
}

#[tauri::command]
pub fn claude_connection_status(
    state: State<'_, SharedState>,
) -> AppResult<ClaudeConnectionReport> {
    let (settings, persisted) = {
        let conn = state.db.lock();
        (
            db::get_settings(&conn)?,
            db::load_claude_connection_report(&conn),
        )
    };
    Ok(status_from_reports(
        &settings,
        persisted.as_ref(),
        state.claude_connection.lock().as_ref(),
    ))
}

fn status_from_reports(
    settings: &db::AppSettings,
    persisted: Option<&ClaudeConnectionReport>,
    memory: Option<&ClaudeConnectionReport>,
) -> ClaudeConnectionReport {
    if !settings.claude_agent_enabled {
        let mut report = ClaudeConnectionReport {
            status: ClaudeConnectionStatus::Disabled,
            configured_cli_path: settings.claude_cli_path.clone(),
            ..Default::default()
        };
        if let Some(last) =
            persisted.filter(|last| last.matches_configured(&settings.claude_cli_path))
        {
            report.effective_model = last.effective_model.clone();
        }
        return report;
    }
    let configured = settings.claude_cli_path.trim();
    if let Some(report) = memory.filter(|report| report.matches_configured(configured)) {
        return report.clone();
    }
    if let Some(mut report) = persisted
        .filter(|report| report.matches_configured(configured))
        .cloned()
    {
        report.status = ClaudeConnectionStatus::LastConnected;
        return report;
    }
    unavailable_report(configured, "Run Test connection in Settings")
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

async fn test_connection(
    cli_path: &str,
    model: Option<&str>,
    state: &SharedState,
) -> ClaudeConnectionReport {
    let trimmed = cli_path.trim();
    let configured = if trimmed.is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(trimmed))
    };
    let detections = match claude_cli::detect_cli(configured.as_deref()) {
        Ok(detections) if !detections.is_empty() => detections,
        _ => return unavailable_report(trimmed, "no Claude CLI candidate found"),
    };
    let detection = detections[0].clone();
    connectivity_probe(&detection, trimmed, model, state).await
}

async fn connectivity_probe(
    detection: &ClaudeDetection,
    configured_path: &str,
    model: Option<&str>,
    state: &SharedState,
) -> ClaudeConnectionReport {
    let probe =
        crate::connection_probe::run_connectivity_probe(state.clone(), configured_path, model)
            .await;
    if !probe.failures.is_empty() {
        return unavailable_report(
            configured_path,
            &format!("nest tool probe failed: {}", probe.failures.join("; ")),
        );
    }
    if !probe.cleanup_warnings.is_empty() {
        return unavailable_report(
            configured_path,
            &format!(
                "nest tool probe left residue: {}",
                probe.cleanup_warnings.join("; ")
            ),
        );
    }
    ClaudeConnectionReport {
        status: ClaudeConnectionStatus::Connected,
        configured_cli_path: configured_path.to_string(),
        resolved_cli_path: detection.resolved_path.clone(),
        cli_version: probe.cli_version,
        effective_model: probe.effective_model,
        tested_at: Utc::now().to_rfc3339(),
        message: None,
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

fn shorten_probe_failure(message: &str) -> String {
    let cleaned = message
        .trim_start_matches("nest tool probe failed: ")
        .trim_start_matches("probe turn failed: ");
    let cleaned = match cleaned.find("API Error: ") {
        Some(at) => &cleaned[at..],
        None => cleaned,
    };
    let first = cleaned.split(';').next().unwrap_or(cleaned).trim();
    let limited: String = first.chars().take(160).collect();
    if first.chars().count() > 160 {
        format!("{limited}…")
    } else {
        limited
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shorten_probe_failure_extracts_api_error_segment() {
        let raw = "nest tool probe failed: probe turn failed: claude_protocol_error: \
                   success: API Error: 400 [1214][modelCode\u{ff1a}\u{4e0d}\u{5b58}\u{5e58}][20260826]; second part";
        let shortened = shorten_probe_failure(raw);
        assert!(shortened.starts_with("API Error: 400"));
        assert!(!shortened.contains("nest tool probe"));
        assert!(!shortened.contains("second part"));
    }

    #[test]
    fn shorten_probe_failure_keeps_plain_message_and_caps_length() {
        assert_eq!(
            shorten_probe_failure("probe turn failed: cancelled"),
            "cancelled"
        );
        let long = "x".repeat(300);
        let shortened = shorten_probe_failure(&long);
        assert!(shortened.chars().count() <= 161);
        assert!(shortened.ends_with('…'));
    }

    fn test_state() -> SharedState {
        std::sync::Arc::new(
            crate::state::AppState::new(
                std::env::temp_dir().join(format!("nest-claude-cmd-{}", uuid::Uuid::new_v4())),
            )
            .unwrap(),
        )
    }

    fn settings_for(enabled: bool, cli: &str) -> db::AppSettings {
        db::AppSettings {
            claude_agent_enabled: enabled,
            claude_cli_path: cli.to_string(),
            ..Default::default()
        }
    }

    fn connected_report(cli: &str, model: &str) -> ClaudeConnectionReport {
        ClaudeConnectionReport {
            status: ClaudeConnectionStatus::Connected,
            configured_cli_path: cli.to_string(),
            effective_model: model.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn disabled_status_keeps_last_effective_model_for_matching_path() {
        let state = test_state();
        {
            let conn = state.db.lock();
            db::save_claude_connection_report(
                &conn,
                &connected_report("C:\\claude.exe", "glm-5.3"),
            )
            .unwrap();
        }
        let persisted = {
            let conn = state.db.lock();
            db::load_claude_connection_report(&conn)
        };
        let report = status_from_reports(
            &settings_for(false, "C:\\claude.exe"),
            persisted.as_ref(),
            None,
        );
        assert_eq!(report.status, ClaudeConnectionStatus::Disabled);
        assert_eq!(report.effective_model, "glm-5.3");
    }

    #[test]
    fn disabled_status_drops_model_from_a_different_path() {
        let state = test_state();
        {
            let conn = state.db.lock();
            db::save_claude_connection_report(
                &conn,
                &connected_report("C:\\claude.exe", "glm-5.3"),
            )
            .unwrap();
        }
        let persisted = {
            let conn = state.db.lock();
            db::load_claude_connection_report(&conn)
        };
        let report = status_from_reports(
            &settings_for(false, "D:\\other.exe"),
            persisted.as_ref(),
            None,
        );
        assert_eq!(report.status, ClaudeConnectionStatus::Disabled);
        assert_eq!(report.effective_model, "");
    }

    #[test]
    fn enabled_status_prefers_memory_then_persisted() {
        let memory = connected_report("C:\\claude.exe", "glm-5.3");
        let persisted = connected_report("C:\\claude.exe", "old-model");
        let report = status_from_reports(
            &settings_for(true, "C:\\claude.exe"),
            Some(&persisted),
            Some(&memory),
        );
        assert_eq!(report.status, ClaudeConnectionStatus::Connected);
        assert_eq!(report.effective_model, "glm-5.3");

        let report = status_from_reports(
            &settings_for(true, "C:\\claude.exe"),
            Some(&persisted),
            None,
        );
        assert_eq!(report.status, ClaudeConnectionStatus::LastConnected);
        assert_eq!(report.effective_model, "old-model");
    }
}
