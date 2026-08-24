#![allow(dead_code)]

use crate::knowledge_workspace::{
    CapabilityMode, KnowledgeError, KnowledgeWorkspace, CAPABILITY_CREATE, CAPABILITY_DELETE,
    CAPABILITY_LIST, CAPABILITY_READ, CAPABILITY_REPLACE, CAPABILITY_SEARCH,
};
use crate::state::SharedState;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use parking_lot::RwLock;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::oneshot;

const MCP_PROTOCOL_VERSION: &str = "2025-06-18";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const SESSION_HEADER: &str = "mcp-session-id";

pub struct ActiveTurn {
    pub session_id: String,
    pub turn_id: String,
    pub mode: CapabilityMode,
    pub knowledge_available: bool,
    pub workspace: RwLock<KnowledgeWorkspace>,
    pub citations: RwLock<Vec<crate::db::Citation>>,
    pub observations: RwLock<Vec<ToolObservation>>,
    pub tool_sequence: std::sync::atomic::AtomicI64,
}

#[derive(Debug, Clone)]
pub struct ToolObservation {
    pub name: String,
    pub target: Option<String>,
    pub succeeded: bool,
    pub output: String,
}

pub type ToolEventSink = Box<dyn Fn(&str, Option<&str>, bool) + Send + Sync>;

pub struct McpServerState {
    pub state: SharedState,
    credential: RwLock<Option<String>>,
    active_turn: RwLock<Option<ActiveTurn>>,
    event_sink: RwLock<Option<ToolEventSink>>,
    shutdown: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct McpServerHandle {
    pub port: u16,
    pub endpoint: String,
    shutdown: Arc<AtomicBool>,
    join: Arc<tokio::sync::Mutex<Option<oneshot::Receiver<()>>>>,
}

impl McpServerHandle {
    pub fn config_json(&self, credential: &str) -> String {
        json!({
            "mcpServers": {
                "nest": {
                    "type": "http",
                    "url": self.endpoint,
                    "headers": {
                        "Authorization": format!("Bearer {credential}")
                    }
                }
            }
        })
        .to_string()
    }

    pub async fn stop(self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(receiver) = self.join.lock().await.take() {
            let _ = receiver.await;
        }
    }
}

impl McpServerState {
    pub fn new(state: SharedState) -> Arc<Self> {
        Arc::new(Self {
            state,
            credential: RwLock::new(None),
            active_turn: RwLock::new(None),
            event_sink: RwLock::new(None),
            shutdown: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn set_event_sink(&self, sink: ToolEventSink) {
        *self.event_sink.write() = Some(sink);
    }

    pub fn clear_event_sink(&self) {
        *self.event_sink.write() = None;
    }

    fn emit_tool_event(&self, label: &str, target: Option<&str>, done: bool) {
        if let Some(sink) = self.event_sink.read().as_ref() {
            sink(label, target, done);
        }
    }

    pub fn begin_turn(
        &self,
        session_id: &str,
        turn_id: &str,
        mode: CapabilityMode,
        protected_paths: Vec<String>,
    ) -> Result<String, String> {
        let mut active = self.active_turn.write();
        if let Some(existing) = active.as_ref() {
            return Err(format!(
                "chat_turn_busy: another turn is already running (turn {})",
                existing.turn_id
            ));
        }
        let credential = format!("nest_{}", uuid::Uuid::new_v4().simple());
        *self.credential.write() = Some(credential.clone());
        *active = Some(ActiveTurn {
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            mode,
            knowledge_available: !crate::vault_reconciliation::load_health(&self.state)
                .reindex_required,
            workspace: RwLock::new(KnowledgeWorkspace::open_turn(
                self.state.clone(),
                mode,
                protected_paths,
            )),
            citations: RwLock::new(Vec::new()),
            observations: RwLock::new(Vec::new()),
            tool_sequence: std::sync::atomic::AtomicI64::new(0),
        });
        Ok(credential)
    }

    pub fn end_turn(&self) {
        *self.active_turn.write() = None;
    }

    pub fn turn_active(&self) -> bool {
        self.active_turn.read().is_some()
    }

    pub fn record_non_nest_activity(&self, name: &str, target: Option<&str>) {
        let turn = self.active_turn.read();
        if let Some(active) = turn.as_ref() {
            let sequence = active
                .tool_sequence
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let conn = self.state.db.lock();
            let _ = crate::db::insert_tool_activity(
                &conn,
                &active.turn_id,
                sequence,
                crate::chat_runtime::tool_source_for(name),
                crate::chat_runtime::tool_kind_for(name),
                name,
                target,
            );
        }
    }

    pub fn finish_staged(&self) -> crate::error::AppResult<Vec<crate::db::NewChatFileChange>> {
        let turn = self.active_turn.read();
        match turn.as_ref() {
            Some(active) => active.workspace.read().finish(),
            None => Ok(Vec::new()),
        }
    }

    pub fn take_citations(&self) -> Vec<crate::db::Citation> {
        let turn = self.active_turn.read();
        match turn.as_ref() {
            Some(active) => {
                let mut citations = active.citations.write();
                std::mem::take(&mut *citations)
            }
            None => Vec::new(),
        }
    }

    pub fn take_tool_observations(&self) -> Vec<ToolObservation> {
        let turn = self.active_turn.read();
        match turn.as_ref() {
            Some(active) => std::mem::take(&mut *active.observations.write()),
            None => Vec::new(),
        }
    }

    fn record_citations(&self, new_citations: Vec<crate::db::Citation>) {
        let turn = self.active_turn.read();
        if let Some(active) = turn.as_ref() {
            let mut citations = active.citations.write();
            for citation in new_citations {
                if !citations
                    .iter()
                    .any(|existing| existing.file_path == citation.file_path)
                {
                    citations.push(citation);
                }
            }
        }
    }

    pub fn abort_staged(&self) {
        if let Some(active) = self.active_turn.read().as_ref() {
            active.workspace.write().abort();
        }
    }

    fn authorize(&self, headers: &HeaderMap) -> bool {
        let Some(expected) = self.credential.read().clone() else {
            return false;
        };
        let Some(value) = headers.get("authorization").and_then(|v| v.to_str().ok()) else {
            return false;
        };
        let Some(token) = value.strip_prefix("Bearer ") else {
            return false;
        };
        constant_time_eq(token.as_bytes(), expected.as_bytes()) && self.active_turn.read().is_some()
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub async fn start_server(state: Arc<McpServerState>) -> crate::error::AppResult<McpServerHandle> {
    let app = Router::new()
        .route("/mcp", post(handle_post))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| {
            crate::error::AppError::msg(format!("MCP listener bind failed: {error}"))
        })?;
    let port = listener
        .local_addr()
        .map_err(|error| crate::error::AppError::msg(error.to_string()))?
        .port();
    let shutdown = state.shutdown.clone();
    let (tx, rx) = oneshot::channel::<()>();
    let server_shutdown = shutdown.clone();
    tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            loop {
                if server_shutdown.load(Ordering::SeqCst) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        });
        let _ = server.await;
        let _ = tx.send(());
    });
    Ok(McpServerHandle {
        port,
        endpoint: format!("http://127.0.0.1:{port}/mcp"),
        shutdown,
        join: Arc::new(tokio::sync::Mutex::new(Some(rx))),
    })
}

async fn handle_post(
    State(server): State<Arc<McpServerState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if body.len() > MAX_REQUEST_BYTES {
        return error_response(StatusCode::PAYLOAD_TOO_LARGE, "request too large");
    }
    if let Some(host) = headers.get("host").and_then(|v| v.to_str().ok()) {
        if !host.starts_with("127.0.0.1") && !host.starts_with("localhost") {
            return error_response(StatusCode::FORBIDDEN, "host not allowed");
        }
    }
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let allowed = ["http://localhost:1420", "http://127.0.0.1:1420", "null"];
        if !allowed.contains(&origin) {
            return error_response(StatusCode::FORBIDDEN, "origin not allowed");
        }
    }
    if !server.authorize(&headers) {
        return error_response(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let message: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return error_response(StatusCode::BAD_REQUEST, "invalid JSON body");
        }
    };
    let response = dispatch(&server, &message).await;
    match serde_json::to_vec(&response) {
        Ok(bytes) if bytes.len() <= MAX_RESPONSE_BYTES => {
            let mut builder = Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/json");
            if let Some(session) = headers.get(SESSION_HEADER).and_then(|v| v.to_str().ok()) {
                builder = builder.header(SESSION_HEADER, session);
            }
            builder
                .body(axum::body::Body::from(bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        _ => error_response(StatusCode::PAYLOAD_TOO_LARGE, "response too large"),
    }
}

fn error_response(status: StatusCode, message: &str) -> Response {
    Response::builder()
        .status(status)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({ "error": message }).to_string(),
        ))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn dispatch(server: &Arc<McpServerState>, message: &Value) -> Value {
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = message.get("id").cloned();
    match method {
        "initialize" => ok_result(
            id,
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "nest", "version": "1.0.0" }
            }),
        ),
        "notifications/initialized" => Value::Null,
        "ping" => ok_result(id, json!({})),
        "tools/list" => {
            let (mode, knowledge_available) = server
                .active_turn
                .read()
                .as_ref()
                .map(|turn| (turn.mode, turn.knowledge_available))
                .unwrap_or((CapabilityMode::Ask, false));
            ok_result(
                id,
                json!({ "tools": tool_definitions(mode, knowledge_available) }),
            )
        }
        "tools/call" => {
            let name = message
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let args = message
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            match call_tool(server, name, &args).await {
                Ok(text) => ok_result(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": text }],
                        "isError": false
                    }),
                ),
                Err(error) => ok_result(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": format!("{error}") }],
                        "isError": true
                    }),
                ),
            }
        }
        _ => {
            let id = id.unwrap_or(Value::Null);
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("method not found: {method}") }
            })
        }
    }
}

fn ok_result(id: Option<Value>, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "result": result
    })
}

fn tool_definitions(mode: CapabilityMode, knowledge_available: bool) -> Vec<Value> {
    if !knowledge_available {
        return Vec::new();
    }
    let mut tools = vec![
        tool_definition(
            "knowledge_search",
            "Search active Nest knowledge packs. Returns file paths, titles, and snippets.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "search query" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
                },
                "required": ["query"]
            }),
        ),
        tool_definition(
            "knowledge_list",
            "List Markdown files in active Nest knowledge packs.",
            json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "optional path filter" }
                }
            }),
        ),
        tool_definition(
            "knowledge_read",
            "Read one Markdown file from an active Nest knowledge pack.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "vault-relative markdown path" }
                },
                "required": ["path"]
            }),
        ),
    ];
    if mode == CapabilityMode::Agent {
        let write_schema = json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "content": { "type": "string" }
            },
            "required": ["path", "content"]
        });
        let path_schema = json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            },
            "required": ["path"]
        });
        tools.push(tool_definition(
            "knowledge_create",
            "Create a new Markdown file in an active editable pack. Staged as a reviewable proposal.",
            write_schema.clone(),
        ));
        tools.push(tool_definition(
            "knowledge_replace",
            "Replace the complete content of an existing Markdown file. Staged as a reviewable proposal.",
            write_schema,
        ));
        tools.push(tool_definition(
            "knowledge_delete",
            "Delete one existing Markdown file. Staged as a reviewable proposal.",
            path_schema,
        ));
    }
    tools
}

fn tool_definition(name: &str, description: &str, schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": schema
    })
}

#[allow(clippy::mut_range_bound)]
async fn call_tool(
    server: &Arc<McpServerState>,
    name: &str,
    args: &Value,
) -> Result<String, KnowledgeError> {
    let target = args
        .get("path")
        .or_else(|| args.get("query"))
        .and_then(Value::as_str)
        .map(|value| value.chars().take(48).collect::<String>());
    server.emit_tool_event(name, target.as_deref(), false);
    let result = call_tool_inner(server, name, args).await;
    let status = if result.is_ok() {
        "succeeded"
    } else {
        "failed"
    };
    if let Some(turn) = server.active_turn.read().as_ref() {
        let output = match &result {
            Ok(value) => value,
            Err(error) => &error.message,
        };
        turn.observations.write().push(ToolObservation {
            name: name.to_string(),
            target: target.clone(),
            succeeded: result.is_ok(),
            output: output.chars().take(4096).collect(),
        });
        let sequence = turn
            .tool_sequence
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let conn = server.state.db.lock();
        let _ = crate::db::insert_tool_activity(
            &conn,
            &turn.turn_id,
            sequence,
            "nest_mcp",
            crate::chat_runtime::tool_kind_for(name),
            name,
            target.as_deref(),
        );
        let _ = crate::db::finish_tool_activity(&conn, &turn.turn_id, sequence, status);
    }
    server.emit_tool_event(name, target.as_deref(), true);
    result
}

async fn call_tool_inner(
    server: &Arc<McpServerState>,
    name: &str,
    args: &Value,
) -> Result<String, KnowledgeError> {
    let capability = match name {
        "knowledge_search" => CAPABILITY_SEARCH,
        "knowledge_list" => CAPABILITY_LIST,
        "knowledge_read" => CAPABILITY_READ,
        "knowledge_create" => CAPABILITY_CREATE,
        "knowledge_replace" => CAPABILITY_REPLACE,
        "knowledge_delete" => CAPABILITY_DELETE,
        other => {
            return Err(KnowledgeError::new(
                "invalid_input",
                format!("unknown tool: {other}"),
            ));
        }
    };
    let mode = {
        let turn = server.active_turn.read();
        let Some(active) = turn.as_ref() else {
            return Err(KnowledgeError::new("permission_denied", "no active turn"));
        };
        if !active.knowledge_available {
            return Err(KnowledgeError::new(
                "reindex_required",
                "Nest Knowledge is unavailable until workspace reindex completes",
            ));
        }
        active.mode
    };
    if !crate::knowledge_workspace::capability_allowed(mode, capability) {
        return Err(KnowledgeError::new(
            "permission_denied",
            format!("{capability} is not available in this chat mode"),
        ));
    }
    if capability == CAPABILITY_SEARCH {
        let query = args
            .get("query")
            .and_then(Value::as_str)
            .ok_or_else(|| KnowledgeError::new("invalid_input", "query is required"))?
            .to_string();
        let limit = args.get("limit").and_then(Value::as_u64).map(|v| v as u32);
        let staged = {
            let turn = server.active_turn.read();
            let Some(active) = turn.as_ref() else {
                return Err(KnowledgeError::new("permission_denied", "no active turn"));
            };
            let staged = active.workspace.read().staged_overlay();
            staged
        };
        let hits = crate::knowledge_workspace::KnowledgeWorkspace::search_turn_with_overlay(
            &server.state,
            &query,
            limit,
            &staged,
        )
        .await?;
        let citations = hits
            .iter()
            .map(|hit| crate::db::Citation {
                chunk_id: String::new(),
                file_path: hit.file_path.clone(),
                title: hit.title.clone(),
                snippet: hit.snippet.clone(),
                score: hit.score,
            })
            .collect::<Vec<_>>();
        server.record_citations(citations);
        return Ok(serde_json::to_string_pretty(&json!({
            "hits": hits.iter().map(|hit| json!({
                "path": hit.file_path,
                "title": hit.title,
                "snippet": hit.snippet,
                "score": hit.score
            })).collect::<Vec<_>>()
        }))
        .unwrap_or_default());
    }

    let turn = server.active_turn.read();
    let Some(active) = turn.as_ref() else {
        return Err(KnowledgeError::new("permission_denied", "no active turn"));
    };
    let mut workspace = active.workspace.write();
    match capability {
        CAPABILITY_LIST => {
            let query = args.get("query").and_then(Value::as_str);
            let result = workspace.list(query)?;
            Ok(serde_json::to_string_pretty(&json!({
                "files": result.files,
                "truncated": result.truncated
            }))
            .unwrap_or_default())
        }
        CAPABILITY_READ => {
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| KnowledgeError::new("invalid_input", "path is required"))?;
            let result = workspace.read(path)?;
            server.record_citations(vec![crate::db::Citation {
                chunk_id: String::new(),
                file_path: result.path.clone(),
                title: path
                    .rsplit('/')
                    .next()
                    .unwrap_or(path)
                    .trim_end_matches(".md")
                    .to_string(),
                snippet: String::new(),
                score: 1.0,
            }]);
            Ok(format!(
                "{}{}",
                result.content,
                if result.truncated {
                    "\n[truncated]"
                } else {
                    ""
                }
            ))
        }
        CAPABILITY_CREATE => {
            let path = required_string(args, "path")?;
            let content = required_string(args, "content")?;
            workspace.create(&path, &content)
        }
        CAPABILITY_REPLACE => {
            let path = required_string(args, "path")?;
            let content = required_string(args, "content")?;
            workspace.replace(&path, &content)
        }
        CAPABILITY_DELETE => {
            let path = required_string(args, "path")?;
            workspace.delete(&path)
        }
        _ => unreachable!(),
    }
}

fn required_string(args: &Value, key: &str) -> Result<String, KnowledgeError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| KnowledgeError::new("invalid_input", format!("{key} is required")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_eq_rejects_mismatched_lengths() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn tool_definitions_match_mode_matrix() {
        let ask = tool_definitions(CapabilityMode::Ask, true);
        assert_eq!(ask.len(), 3);
        let agent = tool_definitions(CapabilityMode::Agent, true);
        assert_eq!(agent.len(), 6);
        let names: Vec<&str> = agent
            .iter()
            .filter_map(|t| t.get("name").and_then(Value::as_str))
            .collect();
        assert!(names.contains(&"knowledge_create"));
        assert!(names.contains(&"knowledge_delete"));
    }

    #[test]
    fn degraded_workspace_exposes_no_knowledge_tools() {
        assert!(tool_definitions(CapabilityMode::Agent, false).is_empty());
    }

    #[test]
    fn config_json_embeds_bearer_credential() {
        let handle = McpServerHandle {
            port: 12345,
            endpoint: "http://127.0.0.1:12345/mcp".to_string(),
            shutdown: Arc::new(AtomicBool::new(false)),
            join: Arc::new(tokio::sync::Mutex::new(None)),
        };
        let config = handle.config_json("nest_token");
        assert!(config.contains("http://127.0.0.1:12345/mcp"));
        assert!(config.contains("nest_token"));
        assert!(config.contains("\"nest\""));
    }

    #[tokio::test]
    async fn server_rejects_unauthorized_and_unknown_tools() {
        let state = crate::state::AppState::new(
            std::env::temp_dir().join(format!("nest-mcp-test-{}", uuid::Uuid::new_v4())),
        )
        .expect("test state");
        let server = McpServerState::new(Arc::new(state));
        let handle = start_server(server.clone()).await.expect("server start");

        let client = reqwest::Client::new();

        let unauthorized = client
            .post(&handle.endpoint)
            .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }))
            .send()
            .await
            .expect("request");
        assert_eq!(unauthorized.status(), 401);

        let credential = server
            .begin_turn("s1", "t1", CapabilityMode::Ask, Vec::new())
            .expect("begin turn");
        let headers = [
            ("Authorization", format!("Bearer {credential}")),
            ("Host", "127.0.0.1".to_string()),
        ];
        let _ = headers;

        let init = client
            .post(&handle.endpoint)
            .header("Authorization", format!("Bearer {credential}"))
            .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }))
            .send()
            .await
            .expect("request");
        assert_eq!(init.status(), 200);
        let body: Value = init.json().await.expect("json");
        assert_eq!(
            body.pointer("/result/serverInfo/name")
                .and_then(Value::as_str),
            Some("nest")
        );

        let tools = client
            .post(&handle.endpoint)
            .header("Authorization", format!("Bearer {credential}"))
            .json(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }))
            .send()
            .await
            .expect("request");
        let body: Value = tools.json().await.expect("json");
        let count = body
            .pointer("/result/tools")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        assert_eq!(count, 3, "ask mode exposes only read-only tools");

        let denied = client
            .post(&handle.endpoint)
            .header("Authorization", format!("Bearer {credential}"))
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": { "name": "knowledge_create", "arguments": { "path": "x.md", "content": "y" } }
            }))
            .send()
            .await
            .expect("request");
        assert_eq!(denied.status(), 200);
        let body: Value = denied.json().await.expect("json");
        assert_eq!(
            body.pointer("/result/isError").and_then(Value::as_bool),
            Some(true)
        );

        server.end_turn();
        let after = client
            .post(&handle.endpoint)
            .header("Authorization", format!("Bearer {credential}"))
            .json(&json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/list" }))
            .send()
            .await
            .expect("request");
        assert_eq!(after.status(), 401, "credential dies with the turn");

        handle.stop().await;
    }
}
