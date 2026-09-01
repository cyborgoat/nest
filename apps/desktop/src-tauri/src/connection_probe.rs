use crate::claude_mcp::{start_server, McpServerState};
use crate::knowledge_workspace::CapabilityMode;
use crate::state::SharedState;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Default)]
pub struct ProbeOutcome {
    #[allow(dead_code)]
    pub tools_exercised: Vec<String>,
    pub failures: Vec<String>,
    pub cleanup_warnings: Vec<String>,
    pub effective_model: String,
    pub cli_version: String,
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(300);

pub async fn run_connectivity_probe(
    state: SharedState,
    cli_path: &str,
    custom_args: &[String],
    model: Option<&str>,
) -> ProbeOutcome {
    let detections =
        match crate::claude_cli::detect_cli(Some(std::path::Path::new(cli_path.trim()))) {
            Ok(detections) if !detections.is_empty() => detections,
            _ => {
                return ProbeOutcome {
                    failures: vec!["invalid_cli_path: CLI not found for probe".to_string()],
                    ..Default::default()
                };
            }
        };
    let detection = detections[0].clone();
    let cancel = state.begin_chat_cancel_arc();

    let server = McpServerState::new(state.clone());
    let handle = match start_server(server.clone()).await {
        Ok(handle) => handle,
        Err(error) => {
            return ProbeOutcome {
                failures: vec![format!("mcp server start failed: {error}")],
                ..Default::default()
            };
        }
    };

    let probe_session = uuid::Uuid::new_v4().to_string();
    let pack_dir = format!("__probe_{probe_session}");
    let pack_root = state.vault_path().join(&pack_dir);
    if let Err(error) = std::fs::create_dir_all(&pack_root) {
        let _ = handle.stop().await;
        return ProbeOutcome {
            failures: vec![format!("probe pack creation failed: {error}")],
            ..Default::default()
        };
    }
    let registration = {
        let conn = state.db.lock();
        crate::db::upsert_sync_state(
            &conn,
            crate::db::SyncStateUpsert {
                pack_id: &pack_dir,
                name: "Nest Connection Probe",
                version: "1.0.0",
                local_path: &pack_dir,
                origin: "local",
                owner_id: None,
                description: "",
                patch_revision: 0,
            },
        )
    };
    if let Err(error) = registration {
        let _ = std::fs::remove_dir_all(&pack_root);
        let _ = handle.stop().await;
        return ProbeOutcome {
            failures: vec![format!("probe pack registration failed: {error}")],
            ..Default::default()
        };
    }

    let probe_turn_id = uuid::Uuid::new_v4().to_string();
    {
        let conn = state.db.lock();
        let _ = conn.execute(
            "INSERT INTO chat_sessions (id, title, title_source, mode, created_at, updated_at)
             VALUES (?1, 'Nest Connection Probe', 'placeholder', 'agent', ?2, ?2)",
            rusqlite::params![probe_session, chrono::Utc::now().to_rfc3339()],
        );
        let _ = conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, citations_json, created_at)
             VALUES (?1, ?2, 'user', 'probe', '', ?3)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                probe_session,
                chrono::Utc::now().to_rfc3339()
            ],
        );
        let _ = conn.execute(
            "INSERT INTO chat_turns (id, session_id, user_message_id, backend_id,
                requested_model_kind, mode, selection_revision, status, started_at)
             SELECT ?1, ?2, id, 'claude', 'default', 'agent', 0, 'running', ?3
             FROM chat_messages WHERE session_id = ?2 ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![
                probe_turn_id,
                probe_session,
                chrono::Utc::now().to_rfc3339()
            ],
        );
    }
    let credential = match server.begin_turn(
        &probe_session,
        &probe_turn_id,
        CapabilityMode::Agent,
        Vec::new(),
    ) {
        Ok(credential) => credential,
        Err(error) => {
            cleanup(
                &state,
                &pack_dir,
                &probe_session,
                &probe_turn_id,
                handle.clone(),
            )
            .await;
            return ProbeOutcome {
                failures: vec![error],
                ..Default::default()
            };
        }
    };
    let mut config = match TempConfig::write(&handle.config_json(&credential)) {
        Ok(config) => config,
        Err(error) => {
            cleanup(
                &state,
                &pack_dir,
                &probe_session,
                &probe_turn_id,
                handle.clone(),
            )
            .await;
            return ProbeOutcome {
                failures: vec![format!("probe mcp config write failed: {error}")],
                ..Default::default()
            };
        }
    };

    let prompt = format!(
        "Use the Nest knowledge tool knowledge_list filtered to {pack} and reply with the \
         file paths it returns. Use only the Nest MCP tools (mcp__nest__*), not your native \
         file tools.",
        pack = pack_dir,
    );

    let turn = tokio::time::timeout(
        PROBE_TIMEOUT,
        crate::claude_cli::run_turn_with_custom_args(
            &detection,
            crate::claude_cli::ClaudeTurnRequest {
                vault_root: &state.vault_path(),
                session_id: &probe_session,
                mode: crate::claude_cli::TurnMode::NewSession,
                prompt: &prompt,
                model: model.filter(|value| !value.trim().is_empty()),
                chat_mode: CapabilityMode::Agent,
                mcp_config_path: Some(config.as_path()),
                system_instructions: None,
            },
            &crate::claude_cli::TurnEvents::default(),
            &cancel,
            custom_args,
        ),
    )
    .await;

    let mut failures = Vec::new();
    let mut effective_model = String::new();
    let mut cli_version = String::new();
    match turn {
        Err(_) => {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            failures.push("probe turn timed out".to_string());
        }
        Ok(Err(error)) => failures.push(format!("probe turn failed: {error}")),
        Ok(Ok(result)) => {
            if let Some(model) = result.model {
                effective_model = model;
            }
            if let Some(version) = result.cli_version {
                cli_version = version;
            }
        }
    }

    let observations = server.take_tool_observations();
    server.end_turn();
    validate_observations(
        &observations,
        &["knowledge_list"],
        &pack_dir,
        &pack_dir,
        &pack_dir,
        &mut failures,
    );

    let mut cleanup_warnings =
        cleanup(&state, &pack_dir, &probe_session, &probe_turn_id, handle).await;
    if let Err(error) = config.cleanup() {
        cleanup_warnings.push(format!("probe config cleanup failed: {error}"));
    }

    let tools_exercised = if failures.is_empty() {
        vec!["mcp__nest__knowledge_list".to_string()]
    } else {
        Vec::new()
    };
    ProbeOutcome {
        tools_exercised,
        failures,
        cleanup_warnings,
        effective_model,
        cli_version,
    }
}

struct TempConfig {
    path: Option<PathBuf>,
}

impl TempConfig {
    fn write(contents: &str) -> std::io::Result<Self> {
        let path = std::env::temp_dir().join(format!(
            "nest-probe-mcp-{}.json",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&path, contents)?;
        Ok(Self { path: Some(path) })
    }

    fn as_path(&self) -> &std::path::Path {
        self.path.as_deref().expect("active probe config")
    }

    fn cleanup(&mut self) -> std::io::Result<()> {
        if let Some(path) = self.path.take() {
            if let Err(error) = std::fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(error);
                }
            }
        }
        Ok(())
    }
}

impl Drop for TempConfig {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn validate_observations(
    observations: &[crate::claude_mcp::ToolObservation],
    expected: &[&str],
    path: &str,
    read_marker: &str,
    search_marker: &str,
    failures: &mut Vec<String>,
) {
    let names = observations
        .iter()
        .map(|item| item.name.as_str())
        .collect::<Vec<_>>();
    if names != expected {
        failures.push(format!(
            "probe MCP response order mismatch: expected {expected:?}, got {names:?}"
        ));
        return;
    }
    for item in observations {
        if !item.succeeded {
            failures.push(format!("probe tool {} returned an error", item.name));
            continue;
        }
        let semantic_ok = match item.name.as_str() {
            "knowledge_create" => item.output.contains("Staged create"),
            "knowledge_replace" => item.output.contains("Staged replace"),
            "knowledge_delete" => item.output.contains("Staged delete"),
            "knowledge_list" => item.output.contains("\"files\""),
            "knowledge_read" => item.output.contains(read_marker),
            "knowledge_search" => item.output.contains(path) && item.output.contains(search_marker),
            _ => false,
        };
        if !semantic_ok {
            failures.push(format!(
                "probe tool {} returned unexpected content",
                item.name
            ));
        }
        if item.target.is_none() {
            failures.push(format!("probe tool {} did not report a target", item.name));
        }
    }
}

async fn cleanup(
    state: &SharedState,
    pack_dir: &str,
    probe_session: &str,
    probe_turn_id: &str,
    handle: crate::claude_mcp::McpServerHandle,
) -> Vec<String> {
    let mut warnings = Vec::new();
    let root = state.vault_path().join(pack_dir);
    if root.exists() {
        if let Err(error) = std::fs::remove_dir_all(&root) {
            warnings.push(format!("probe cleanup failed: {error}"));
        }
    }
    {
        let conn = state.db.lock();
        if let Err(error) = crate::db::purge_path_data(&conn, pack_dir) {
            warnings.push(format!("probe pack deregistration failed: {error}"));
        }
        let _ = crate::db::finalize_running_tool_activities(&conn, probe_turn_id, "succeeded");
        let _ = conn.execute(
            "DELETE FROM chat_sessions WHERE id = ?1",
            rusqlite::params![probe_session],
        );
        let session_count = conn
            .query_row(
                "SELECT COUNT(*) FROM chat_sessions WHERE id = ?1",
                rusqlite::params![probe_session],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(1);
        let pack_count = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_state WHERE pack_id = ?1 OR local_path = ?1",
                rusqlite::params![pack_dir],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(1);
        let chunk_prefix = format!("{pack_dir}/%");
        let chunk_count = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks WHERE file_path = ?1 OR file_path LIKE ?2",
                rusqlite::params![pack_dir, chunk_prefix],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(1);
        if session_count != 0 || pack_count != 0 || chunk_count != 0 {
            warnings.push(format!(
                "probe residue remained: sessions={session_count}, packs={pack_count}, chunks={chunk_count}"
            ));
        }
    }
    handle.stop().await;
    if root.exists() {
        warnings.push("probe vault directory remained after cleanup".to_string());
    }
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_validation_rejects_wrong_order_and_content() {
        let observations = vec![
            crate::claude_mcp::ToolObservation {
                name: "knowledge_read".to_string(),
                target: Some("pack/probe.md".to_string()),
                succeeded: true,
                output: "wrong".to_string(),
            },
            crate::claude_mcp::ToolObservation {
                name: "knowledge_search".to_string(),
                target: Some("token".to_string()),
                succeeded: true,
                output: "pack/probe.md token".to_string(),
            },
        ];
        let mut failures = Vec::new();
        validate_observations(
            &observations,
            &["knowledge_search", "knowledge_read"],
            "pack/probe.md",
            "token",
            "token",
            &mut failures,
        );
        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("order mismatch"));
    }

    #[test]
    fn semantic_validation_accepts_search_and_read_payloads() {
        let observations = vec![
            crate::claude_mcp::ToolObservation {
                name: "knowledge_search".to_string(),
                target: Some("token".to_string()),
                succeeded: true,
                output: r#"{"hits":[{"path":"pack/probe.md","snippet":"token"}]}"#.to_string(),
            },
            crate::claude_mcp::ToolObservation {
                name: "knowledge_read".to_string(),
                target: Some("pack/probe.md".to_string()),
                succeeded: true,
                output: "# Probe\n\ntoken".to_string(),
            },
        ];
        let mut failures = Vec::new();
        validate_observations(
            &observations,
            &["knowledge_search", "knowledge_read"],
            "pack/probe.md",
            "token",
            "token",
            &mut failures,
        );
        assert!(failures.is_empty(), "{failures:?}");
    }

    #[test]
    fn turn_one_validation_accepts_read_before_replace() {
        let observations = vec![
            crate::claude_mcp::ToolObservation {
                name: "knowledge_create".to_string(),
                target: Some("pack/probe.md".to_string()),
                succeeded: true,
                output: "Staged create: pack/probe.md".to_string(),
            },
            crate::claude_mcp::ToolObservation {
                name: "knowledge_list".to_string(),
                target: Some("pack".to_string()),
                succeeded: true,
                output: r#"{"files":["pack/probe.md"]}"#.to_string(),
            },
            crate::claude_mcp::ToolObservation {
                name: "knowledge_read".to_string(),
                target: Some("pack/probe.md".to_string()),
                succeeded: true,
                output: "# Probe\n\nmarker".to_string(),
            },
            crate::claude_mcp::ToolObservation {
                name: "knowledge_replace".to_string(),
                target: Some("pack/probe.md".to_string()),
                succeeded: true,
                output: "Staged replace: pack/probe.md".to_string(),
            },
        ];
        let mut failures = Vec::new();
        validate_observations(
            &observations,
            &[
                "knowledge_create",
                "knowledge_list",
                "knowledge_read",
                "knowledge_replace",
            ],
            "pack/probe.md",
            "marker",
            "marker-v2",
            &mut failures,
        );
        assert!(failures.is_empty(), "{failures:?}");
    }

    #[test]
    fn semantic_validation_accepts_empty_list_result() {
        let observations = vec![crate::claude_mcp::ToolObservation {
            name: "knowledge_list".to_string(),
            target: Some("__probe_x".to_string()),
            succeeded: true,
            output: "{\n  \"files\": [],\n  \"truncated\": false\n}".to_string(),
        }];
        let mut failures = Vec::new();
        validate_observations(
            &observations,
            &["knowledge_list"],
            "__probe_x",
            "__probe_x",
            "__probe_x",
            &mut failures,
        );
        assert!(failures.is_empty(), "{failures:?}");
    }

    #[test]
    fn temporary_mcp_config_is_removed_explicitly() {
        let mut config = TempConfig::write("{}").unwrap();
        let path = config.as_path().to_path_buf();
        assert!(path.exists());
        config.cleanup().unwrap();
        assert!(!path.exists());
    }
}
