use crate::claude_mcp::{start_server, McpServerState};
use crate::knowledge_workspace::CapabilityMode;
use crate::state::SharedState;
use serde_json::{json, Value};

use crate::connection_probe::{ProbeOutcome, SinkBuilder};

pub async fn run_direct_probe(
    state: SharedState,
    sink_builder: Option<SinkBuilder>,
) -> ProbeOutcome {
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
        let _ = handle.stop().await;
        return ProbeOutcome {
            tools_exercised: Vec::new(),
            failures: vec![format!("probe pack registration failed: {error}")],
            cleanup_warnings: Vec::new(),
        };
    }
    let create_path = format!("{pack_dir}/probe.md");
    let challenge = format!("nest-probe-{}", uuid::Uuid::new_v4().simple());
    let credential =
        match server.begin_turn(&probe_session, "probe", CapabilityMode::Agent, Vec::new()) {
            Ok(credential) => credential,
            Err(error) => {
                let _ = std::fs::remove_dir_all(state.vault_path().join(&pack_dir));
                {
                    let conn = state.db.lock();
                    let _ = crate::db::purge_path_data(&conn, &pack_dir);
                }
                handle.stop().await;
                return ProbeOutcome {
                    tools_exercised: Vec::new(),
                    failures: vec![error],
                    cleanup_warnings: Vec::new(),
                };
            }
        };
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{}/mcp", handle.port);
    let auth = format!("Bearer {credential}");

    let mut tools_exercised: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    async fn call_tool(
        client: &reqwest::Client,
        url: &str,
        auth: &str,
        name: &str,
        args: Value,
    ) -> Result<Value, String> {
        let response = client
            .post(url)
            .header("Authorization", auth)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": { "name": name, "arguments": args }
            }))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        response
            .json::<Value>()
            .await
            .map_err(|error| error.to_string())
    }

    fn tool_error(body: &Value) -> Option<String> {
        if body
            .pointer("/result/isError")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            Some(
                body.pointer("/result/content/0/text")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown error")
                    .to_string(),
            )
        } else {
            None
        }
    }

    let create = call_tool(
        &client,
        &url,
        &auth,
        "knowledge_create",
        json!({
            "path": create_path,
            "content": format!("# Probe\n\n{challenge}\n")
        }),
    )
    .await;
    match create {
        Ok(body) => match tool_error(&body) {
            None => tools_exercised.push("mcp__nest__knowledge_create".to_string()),
            Some(error) => failures.push(format!("knowledge_create: {error}")),
        },
        Err(error) => failures.push(format!("knowledge_create: {error}")),
    }

    let list = call_tool(
        &client,
        &url,
        &auth,
        "knowledge_list",
        json!({ "query": &pack_dir }),
    )
    .await;
    match list {
        Ok(body) => match tool_error(&body) {
            None => tools_exercised.push("mcp__nest__knowledge_list".to_string()),
            Some(error) => failures.push(format!("knowledge_list: {error}")),
        },
        Err(error) => failures.push(format!("knowledge_list: {error}")),
    }

    let read = call_tool(
        &client,
        &url,
        &auth,
        "knowledge_read",
        json!({ "path": &create_path }),
    )
    .await;
    match read {
        Ok(body) => {
            let error = tool_error(&body);
            let text = body
                .pointer("/result/content/0/text")
                .and_then(Value::as_str)
                .unwrap_or("");
            match error {
                None if text.contains(&challenge) => {
                    tools_exercised.push("mcp__nest__knowledge_read".to_string())
                }
                None => failures.push("knowledge_read: challenge text not returned".to_string()),
                Some(error) => failures.push(format!("knowledge_read: {error}")),
            }
        }
        Err(error) => failures.push(format!("knowledge_read: {error}")),
    }

    let replaced = format!("{challenge}-replaced");
    let replace = call_tool(
        &client,
        &url,
        &auth,
        "knowledge_replace",
        json!({
            "path": &create_path,
            "content": format!("# Probe\n\n{replaced}\n")
        }),
    )
    .await;
    match replace {
        Ok(body) => match tool_error(&body) {
            None => tools_exercised.push("mcp__nest__knowledge_replace".to_string()),
            Some(error) => failures.push(format!("knowledge_replace: {error}")),
        },
        Err(error) => failures.push(format!("knowledge_replace: {error}")),
    }

    let delete = call_tool(
        &client,
        &url,
        &auth,
        "knowledge_delete",
        json!({ "path": &create_path }),
    )
    .await;
    match delete {
        Ok(body) => match tool_error(&body) {
            None => tools_exercised.push("mcp__nest__knowledge_delete".to_string()),
            Some(error) => failures.push(format!("knowledge_delete: {error}")),
        },
        Err(error) => failures.push(format!("knowledge_delete: {error}")),
    }

    let search = call_tool(
        &client,
        &url,
        &auth,
        "knowledge_search",
        json!({ "query": format!("probe {challenge}") }),
    )
    .await;
    match search {
        Ok(body) => match tool_error(&body) {
            None => tools_exercised.push("mcp__nest__knowledge_search".to_string()),
            Some(error) => failures.push(format!("knowledge_search: {error}")),
        },
        Err(error) => failures.push(format!("knowledge_search: {error}")),
    }

    let _ = server.finish_staged();
    server.abort_staged();
    server.end_turn();
    server.clear_event_sink();
    handle.stop().await;

    let probe_root = state.vault_path().join(&pack_dir);
    let mut cleanup_warnings = Vec::new();
    if probe_root.exists() {
        if let Err(error) = std::fs::remove_dir_all(&probe_root) {
            cleanup_warnings.push(format!("probe cleanup failed: {error}"));
        }
    }
    {
        let conn = state.db.lock();
        if let Err(error) = crate::db::purge_path_data(&conn, &pack_dir) {
            cleanup_warnings.push(format!("probe pack deregistration failed: {error}"));
        }
        let _ = crate::db::finalize_running_tool_activities(&conn, "probe", "succeeded");
    }

    ProbeOutcome {
        tools_exercised,
        failures,
        cleanup_warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn probe_exercises_all_six_tools_against_temp_vault() {
        let root = std::env::temp_dir().join(format!("nest-probe-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let state = crate::state::AppState::new(root.clone()).expect("test state");
        let outcome = run_direct_probe(Arc::new(state), None).await;
        assert!(
            outcome.failures.is_empty(),
            "failures: {:?}",
            outcome.failures
        );
        assert_eq!(
            outcome.tools_exercised.len(),
            6,
            "{:?}",
            outcome.tools_exercised
        );
        assert!(outcome.cleanup_warnings.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
