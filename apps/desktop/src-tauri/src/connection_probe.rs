use crate::claude_mcp::{start_server, McpServerState, ToolEventSink};
use crate::knowledge_workspace::CapabilityMode;
use crate::state::SharedState;
use std::path::PathBuf;
use std::time::Duration;

pub struct ProbeOutcome {
    #[allow(dead_code)]
    pub tools_exercised: Vec<String>,
    pub failures: Vec<String>,
    pub cleanup_warnings: Vec<String>,
}

pub type SinkBuilder = Box<dyn FnOnce() -> ToolEventSink + Send>;

#[allow(dead_code)]
const PROBE_TIMEOUT: Duration = Duration::from_secs(300);

pub async fn run_six_tool_probe(
    state: SharedState,
    sink_builder: Option<SinkBuilder>,
    cli_path: Option<String>,
) -> ProbeOutcome {
    match cli_path.as_deref() {
        Some(path) => run_claude_driven_probe(state, sink_builder, path).await,
        None => crate::connection_probe_direct::run_direct_probe(state, sink_builder).await,
    }
}

struct ProbeEnv {
    probe_session: String,
    probe_turn_id: String,
    pack_dir: String,
    probe_path: String,
    challenge: String,
    config: TempConfig,
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

async fn run_claude_driven_probe(
    state: SharedState,
    sink_builder: Option<SinkBuilder>,
    cli_path: &str,
) -> ProbeOutcome {
    let detections =
        match crate::claude_cli::detect_cli(Some(std::path::Path::new(cli_path.trim()))) {
            Ok(detections) if !detections.is_empty() => detections,
            _ => {
                return ProbeOutcome {
                    tools_exercised: Vec::new(),
                    failures: vec!["invalid_cli_path: CLI not found for probe".to_string()],
                    cleanup_warnings: Vec::new(),
                };
            }
        };
    let detection = detections[0].clone();
    let cancel = state.begin_chat_cancel_arc();

    let server = McpServerState::new(state.clone());
    if let Some(builder) = sink_builder {
        server.set_event_sink(builder());
    }
    let handle = match start_server(server.clone()).await {
        Ok(handle) => handle,
        Err(error) => {
            return ProbeOutcome {
                tools_exercised: Vec::new(),
                failures: vec![format!("mcp server start failed: {error}")],
                cleanup_warnings: Vec::new(),
            };
        }
    };

    let probe_session = uuid::Uuid::new_v4().to_string();
    let pack_dir = format!("__probe_{probe_session}");
    let pack_root = state.vault_path().join(&pack_dir);
    if let Err(error) = std::fs::create_dir_all(&pack_root) {
        let _ = handle.stop().await;
        return ProbeOutcome {
            tools_exercised: Vec::new(),
            failures: vec![format!("probe pack creation failed: {error}")],
            cleanup_warnings: Vec::new(),
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
            tools_exercised: Vec::new(),
            failures: vec![format!("probe pack registration failed: {error}")],
            cleanup_warnings: Vec::new(),
        };
    }

    let probe_path = format!("{pack_dir}/probe.md");
    let challenge = format!("nest-probe-{}", uuid::Uuid::new_v4().simple());
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
            cleanup(&state, &pack_dir, &probe_session, "", handle.clone()).await;
            return ProbeOutcome {
                tools_exercised: Vec::new(),
                failures: vec![error],
                cleanup_warnings: Vec::new(),
            };
        }
    };
    let config = match TempConfig::write(&handle.config_json(&credential)) {
        Ok(config) => config,
        Err(error) => {
            cleanup(&state, &pack_dir, &probe_session, "", handle.clone()).await;
            return ProbeOutcome {
                tools_exercised: Vec::new(),
                failures: vec![format!("probe mcp config write failed: {error}")],
                cleanup_warnings: Vec::new(),
            };
        }
    };

    let mut env = ProbeEnv {
        probe_session,
        probe_turn_id,
        pack_dir,
        probe_path,
        challenge,
        config,
    };

    let turn1_prompt = format!(
        "Use the Nest knowledge tools to do exactly these steps, in order:\n\
         1. knowledge_create at path {path} with this exact marker on its own line: {marker}\n\
         2. knowledge_list filtered to {pack}\n\
         3. knowledge_read {path}\n\
         4. knowledge_replace {path} changing the marker line to {marker2}\n\
         Use only the Nest MCP tools (mcp__nest__*), not your native file tools. Reply with a one-line confirmation of each step.",
        path = env.probe_path,
        marker = env.challenge,
        marker2 = format_args!("{}-v2", env.challenge),
        pack = env.pack_dir,
    );

    let turn1 = tokio::time::timeout(
        PROBE_TIMEOUT,
        crate::claude_cli::run_turn(
            &detection,
            crate::claude_cli::ClaudeTurnRequest {
                vault_root: &state.vault_path(),
                session_id: &env.probe_session,
                mode: crate::claude_cli::TurnMode::NewSession,
                prompt: &turn1_prompt,
                model: None,
                chat_mode: CapabilityMode::Agent,
                mcp_config_path: Some(env.config.as_path()),
                system_instructions: None,
            },
            &crate::claude_cli::TurnEvents::default(),
            &cancel,
        ),
    )
    .await;
    let turn1 = match turn1 {
        Ok(result) => result,
        Err(_) => {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            server.abort_staged();
            server.end_turn();
            server.clear_event_sink();
            let mut cleanup_warnings = cleanup(
                &state,
                &env.pack_dir,
                &env.probe_session,
                &env.probe_turn_id,
                handle.clone(),
            )
            .await;
            if let Err(error) = env.config.cleanup() {
                cleanup_warnings.push(format!("probe config cleanup failed: {error}"));
            }
            return ProbeOutcome {
                tools_exercised: Vec::new(),
                failures: vec!["probe turn 1 timed out".to_string()],
                cleanup_warnings,
            };
        }
    };
    if let Err(error) = turn1 {
        server.end_turn();
        server.clear_event_sink();
        let mut outcome = cleanup(
            &state,
            &env.pack_dir,
            &env.probe_session,
            &env.probe_turn_id,
            handle.clone(),
        )
        .await;
        if let Err(error) = env.config.cleanup() {
            outcome.push(format!("probe config cleanup failed: {error}"));
        }
        return ProbeOutcome {
            tools_exercised: Vec::new(),
            failures: vec![format!("probe turn 1 failed: {error}")],
            cleanup_warnings: outcome,
        };
    }

    let mut failures = Vec::new();

    let observations1 = server.take_tool_observations();
    let staged1 = match server.finish_staged() {
        Ok(changes) => changes,
        Err(error) => {
            failures.push(format!("probe turn 1 staging failed: {error}"));
            Vec::new()
        }
    };
    server.end_turn();

    let turn1_create = staged1.iter().find(|c| {
        c.operation == "created"
            && c.path == env.probe_path
            && c.new_content
                .as_deref()
                .is_some_and(|content| content.contains(&format!("{}-v2", env.challenge)))
    });
    if turn1_create.is_none() {
        failures.push(
            "probe turn 1 did not stage a knowledge_create containing the marker".to_string(),
        );
    }
    validate_observations(
        &observations1,
        &[
            "knowledge_create",
            "knowledge_list",
            "knowledge_read",
            "knowledge_replace",
        ],
        &env.probe_path,
        &env.challenge,
        &format!("{}-v2", env.challenge),
        &mut failures,
    );
    if failures.is_empty() {
        if let Err(error) = persist_and_apply(&state, &env.probe_session, &staged1) {
            failures.push(format!("probe turn 1 review/apply failed: {error}"));
        }
    }
    if failures.is_empty() {
        if let Err(error) =
            crate::indexing::schedule_and_wait(&state, Duration::from_secs(120)).await
        {
            failures.push(format!("probe turn 1 reindex failed: {error}"));
        }
    }
    if failures.is_empty() {
        match verify_search(&state, &format!("{}-v2", env.challenge), &env.probe_path).await {
            Ok(true) => {}
            Ok(false) => failures
                .push("probe turn 1 marker was not visible through indexed search".to_string()),
            Err(error) => failures.push(format!("probe turn 1 search validation failed: {error}")),
        }
    }

    let probe_turn2_id = uuid::Uuid::new_v4().to_string();
    {
        let conn = state.db.lock();
        let message_id = uuid::Uuid::new_v4().to_string();
        let _ = conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, citations_json, created_at)
             VALUES (?1, ?2, 'user', 'probe-2', '', ?3)",
            rusqlite::params![
                message_id,
                env.probe_session,
                chrono::Utc::now().to_rfc3339()
            ],
        );
        let _ = conn.execute(
            "INSERT INTO chat_turns (id, session_id, user_message_id, backend_id,
                requested_model_kind, mode, selection_revision, status, started_at)
             VALUES (?1, ?2, ?3, 'claude', 'default', 'agent', 0, 'running', ?4)",
            rusqlite::params![
                probe_turn2_id,
                env.probe_session,
                message_id,
                chrono::Utc::now().to_rfc3339()
            ],
        );
    }

    let credential2 = match server.begin_turn(
        &env.probe_session,
        &probe_turn2_id,
        CapabilityMode::Agent,
        Vec::new(),
    ) {
        Ok(credential) => credential,
        Err(error) => {
            server.clear_event_sink();
            failures.push(error);
            let mut outcome = cleanup(
                &state,
                &env.pack_dir,
                &env.probe_session,
                &env.probe_turn_id,
                handle.clone(),
            )
            .await;
            if let Err(error) = env.config.cleanup() {
                outcome.push(format!("probe config cleanup failed: {error}"));
            }
            return ProbeOutcome {
                tools_exercised: Vec::new(),
                failures,
                cleanup_warnings: outcome,
            };
        }
    };
    let mut config2 = match TempConfig::write(&handle.config_json(&credential2)) {
        Ok(config) => config,
        Err(error) => {
            server.clear_event_sink();
            failures.push(format!("probe mcp config write failed: {error}"));
            let mut outcome = cleanup(
                &state,
                &env.pack_dir,
                &env.probe_session,
                &env.probe_turn_id,
                handle.clone(),
            )
            .await;
            if let Err(cleanup_error) = env.config.cleanup() {
                outcome.push(format!("probe config cleanup failed: {cleanup_error}"));
            }
            return ProbeOutcome {
                tools_exercised: Vec::new(),
                failures,
                cleanup_warnings: outcome,
            };
        }
    };

    let turn2_prompt = format!(
        "Using the Nest knowledge tools only:\n\
         1. knowledge_search for the marker {marker}\n\
         2. knowledge_read {path} to confirm the current marker\n\
         3. knowledge_delete {path}\n\
         Reply with a one-line confirmation of each step.",
        marker = format_args!("{}-v2", env.challenge),
        path = env.probe_path,
    );

    let turn2 = tokio::time::timeout(
        PROBE_TIMEOUT,
        crate::claude_cli::run_turn(
            &detection,
            crate::claude_cli::ClaudeTurnRequest {
                vault_root: &state.vault_path(),
                session_id: &env.probe_session,
                mode: crate::claude_cli::TurnMode::Resume,
                prompt: &turn2_prompt,
                model: None,
                chat_mode: CapabilityMode::Agent,
                mcp_config_path: Some(config2.as_path()),
                system_instructions: None,
            },
            &crate::claude_cli::TurnEvents::default(),
            &cancel,
        ),
    )
    .await;
    match turn2 {
        Ok(Err(error)) => failures.push(format!("probe turn 2 failed: {error}")),
        Err(_) => {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            failures.push("probe turn 2 timed out".to_string());
        }
        Ok(Ok(_)) => {}
    }

    let observations2 = server.take_tool_observations();
    let staged2 = match server.finish_staged() {
        Ok(changes) => changes,
        Err(error) => {
            failures.push(format!("probe turn 2 staging failed: {error}"));
            Vec::new()
        }
    };
    let turn2_delete_ok = staged2
        .iter()
        .any(|c| c.operation == "deleted" && c.path == env.probe_path);
    if !turn2_delete_ok {
        failures.push("probe turn 2 did not stage a knowledge_delete".to_string());
    }
    validate_observations(
        &observations2,
        &["knowledge_search", "knowledge_read", "knowledge_delete"],
        &env.probe_path,
        &format!("{}-v2", env.challenge),
        &format!("{}-v2", env.challenge),
        &mut failures,
    );
    server.end_turn();
    server.clear_event_sink();

    if failures.is_empty() {
        if let Err(error) = persist_and_apply(&state, &env.probe_session, &staged2) {
            failures.push(format!("probe turn 2 review/apply failed: {error}"));
        }
    }
    if failures.is_empty() {
        if let Err(error) =
            crate::indexing::schedule_and_wait(&state, Duration::from_secs(120)).await
        {
            failures.push(format!("probe turn 2 reindex failed: {error}"));
        }
    }
    if failures.is_empty() {
        if state.vault_path().join(&env.probe_path).exists() {
            failures.push("probe delete was approved but the file still exists".to_string());
        }
        match verify_search(&state, &format!("{}-v2", env.challenge), &env.probe_path).await {
            Ok(false) => {}
            Ok(true) => failures
                .push("probe deleted marker remained visible through indexed search".to_string()),
            Err(error) => failures.push(format!("probe delete search validation failed: {error}")),
        }
    }

    let called = {
        let conn = state.db.lock();
        let mut all =
            crate::db::list_tool_activities(&conn, &env.probe_turn_id).unwrap_or_default();
        all.extend(crate::db::list_tool_activities(&conn, &probe_turn2_id).unwrap_or_default());
        all
    };
    validate_activity_sequence(
        &called,
        &env.probe_turn_id,
        &[
            "knowledge_create",
            "knowledge_list",
            "knowledge_read",
            "knowledge_replace",
        ],
        &mut failures,
    );
    validate_activity_sequence(
        &called,
        &probe_turn2_id,
        &["knowledge_search", "knowledge_read", "knowledge_delete"],
        &mut failures,
    );
    let required = [
        "knowledge_create",
        "knowledge_list",
        "knowledge_read",
        "knowledge_replace",
        "knowledge_search",
        "knowledge_delete",
    ];
    let mut tools_exercised = Vec::new();
    for tool in required {
        let prefixed = format!("mcp__nest__{tool}");
        let seen = called
            .iter()
            .any(|row| (row.label == tool || row.label == prefixed) && row.status == "succeeded");
        if seen {
            tools_exercised.push(prefixed);
        } else {
            failures.push(format!("nest tool not exercised by Claude: {tool}"));
        }
    }

    let marker_seen = staged1.iter().any(|c| {
        c.new_content
            .as_deref()
            .is_some_and(|text| text.contains(&format!("{}-v2", env.challenge)))
    });
    if !marker_seen {
        failures.push("probe marker not found in staged create content".to_string());
    }

    let native_reads = called
        .iter()
        .filter(|row| {
            !row.label.starts_with("mcp__nest__")
                && !row.label.starts_with("knowledge_")
                && matches!(
                    row.label.to_ascii_lowercase().as_str(),
                    "read" | "edit" | "write" | "bash"
                )
        })
        .count();
    if native_reads > 0 {
        failures.push(format!(
            "nest_tool_route_bypassed: Claude used native file tools {native_reads} times during the probe"
        ));
    }

    let mut cleanup_warnings = cleanup(
        &state,
        &env.pack_dir,
        &env.probe_session,
        &env.probe_turn_id,
        handle.clone(),
    )
    .await;
    if let Err(error) = config2.cleanup() {
        cleanup_warnings.push(format!("probe config cleanup failed: {error}"));
    }
    if let Err(error) = env.config.cleanup() {
        cleanup_warnings.push(format!("probe config cleanup failed: {error}"));
    }
    ProbeOutcome {
        tools_exercised,
        failures,
        cleanup_warnings,
    }
}

fn persist_and_apply(
    state: &SharedState,
    session_id: &str,
    changes: &[crate::db::NewChatFileChange],
) -> Result<(), String> {
    if changes.is_empty() {
        return Err("no staged changes were produced".to_string());
    }
    let message = {
        let mut conn = state.db.lock();
        crate::db::add_message(
            &mut conn,
            session_id,
            crate::db::NewChatMessage {
                role: "assistant",
                content: "connection probe proposal",
                citations: None,
                thinking: None,
                thinking_seconds: None,
                file_changes: changes,
            },
        )
        .map_err(|error| error.to_string())?
    };
    for change in message.file_changes {
        match crate::knowledge_review::KnowledgeReview::review(state, &change.id, true)
            .map_err(|error| error.to_string())?
        {
            crate::knowledge_review::ReviewOutcome::Approved => {}
            _ => return Err(format!("proposal {} did not reach approved", change.id)),
        }
    }
    Ok(())
}

async fn verify_search(
    state: &SharedState,
    token: &str,
    expected_path: &str,
) -> Result<bool, String> {
    crate::knowledge_workspace::KnowledgeWorkspace::search_turn(state, token, Some(10))
        .await
        .map(|hits| hits.iter().any(|hit| hit.file_path == expected_path))
        .map_err(|error| error.to_string())
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
            "knowledge_list" => item.output.contains(path),
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

fn validate_activity_sequence(
    activities: &[crate::db::ToolActivityRow],
    turn_id: &str,
    expected: &[&str],
    failures: &mut Vec<String>,
) {
    let nest = activities
        .iter()
        .filter(|row| row.turn_id == turn_id && row.source == "nest_mcp")
        .collect::<Vec<_>>();
    let labels = nest
        .iter()
        .map(|row| row.label.as_str())
        .collect::<Vec<_>>();
    if labels != expected {
        failures.push(format!(
            "probe activity order mismatch: expected {expected:?}, got {labels:?}"
        ));
    }
    if nest.iter().any(|row| row.status != "succeeded") {
        failures.push("probe recorded a non-succeeded Nest MCP activity".to_string());
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
    fn temporary_mcp_config_is_removed_explicitly() {
        let mut config = TempConfig::write("{}").unwrap();
        let path = config.as_path().to_path_buf();
        assert!(path.exists());
        config.cleanup().unwrap();
        assert!(!path.exists());
    }
}
