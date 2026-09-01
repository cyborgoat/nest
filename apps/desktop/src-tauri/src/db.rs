use crate::error::{AppError, AppResult};
use crate::retrieval::snippet;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

pub const LEGACY_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
pub const LEGACY_OPENAI_CHAT_MODEL: &str = "gpt-4o-mini";
pub const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
pub const OPENROUTER_DEFAULT_CHAT_MODEL: &str = "openai/gpt-4o-mini";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub llm_base_url: String,
    pub llm_api_key: String,
    pub chat_model: String,
    pub hub_base_url: String,
    /// Optional HTTP(S)/SOCKS5 proxy for Hub (and title) outbound requests.
    #[serde(default)]
    pub proxy_url: String,
    /// When false, Nest connects directly and ignores `proxy_url`.
    #[serde(default)]
    pub proxy_enabled: bool,
    #[serde(default = "default_font_size_pt")]
    pub font_size_pt: u32,
    #[serde(default = "default_display_language")]
    pub display_language: String,
    /// Custom knowledge / vault directory. Empty means default `{app_data}/vault`.
    #[serde(default)]
    pub knowledge_dir: String,
    /// Absolute path currently used for packs (not persisted).
    #[serde(default)]
    pub resolved_knowledge_dir: String,
    #[serde(default)]
    pub claude_agent_enabled: bool,
    #[serde(default)]
    pub claude_cli_path: String,
    #[serde(default)]
    pub claude_custom_args: String,
    #[serde(default)]
    pub claude_custom_models: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            llm_base_url: String::new(),
            llm_api_key: String::new(),
            chat_model: String::new(),
            hub_base_url: String::new(),
            proxy_url: String::new(),
            proxy_enabled: false,
            font_size_pt: default_font_size_pt(),
            display_language: default_display_language(),
            knowledge_dir: String::new(),
            resolved_knowledge_dir: String::new(),
            claude_agent_enabled: false,
            claude_cli_path: String::new(),
            claude_custom_args: String::new(),
            claude_custom_models: String::new(),
        }
    }
}

fn default_font_size_pt() -> u32 {
    if cfg!(target_os = "windows") {
        12
    } else {
        10
    }
}

fn default_display_language() -> String {
    "en".into()
}

impl AppSettings {
    /// Normalize user-entered LLM settings and correct the common case where
    /// an OpenRouter key is pasted while Nest's untouched OpenAI defaults are
    /// still selected. Explicit custom endpoints and models are preserved.
    pub fn normalize_llm_configuration(&mut self) {
        normalize_llm_configuration_fields(
            &mut self.llm_base_url,
            &mut self.llm_api_key,
            &mut self.chat_model,
        );
    }

    /// Proxy URL used for outbound requests when enabled; otherwise empty (direct).
    pub fn effective_proxy_url(&self) -> &str {
        if self.proxy_enabled {
            self.proxy_url.trim()
        } else {
            ""
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GeneralSettingsUpdate {
    pub llm_base_url: String,
    pub llm_api_key: String,
    pub chat_model: String,
    pub hub_base_url: String,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default)]
    pub proxy_enabled: bool,
    #[serde(default = "default_font_size_pt")]
    pub font_size_pt: u32,
    #[serde(default = "default_display_language")]
    pub display_language: String,
    #[serde(default)]
    pub knowledge_dir: String,
}

impl From<&AppSettings> for GeneralSettingsUpdate {
    fn from(settings: &AppSettings) -> Self {
        Self {
            llm_base_url: settings.llm_base_url.clone(),
            llm_api_key: settings.llm_api_key.clone(),
            chat_model: settings.chat_model.clone(),
            hub_base_url: settings.hub_base_url.clone(),
            proxy_url: settings.proxy_url.clone(),
            proxy_enabled: settings.proxy_enabled,
            font_size_pt: settings.font_size_pt,
            display_language: settings.display_language.clone(),
            knowledge_dir: settings.knowledge_dir.clone(),
        }
    }
}

impl GeneralSettingsUpdate {
    pub fn normalize_llm_configuration(&mut self) {
        normalize_llm_configuration_fields(
            &mut self.llm_base_url,
            &mut self.llm_api_key,
            &mut self.chat_model,
        );
    }
}

fn normalize_llm_configuration_fields(
    llm_base_url: &mut String,
    llm_api_key: &mut String,
    chat_model: &mut String,
) {
    *llm_base_url = llm_base_url.trim().trim_end_matches('/').to_string();
    *llm_api_key = llm_api_key.trim().to_string();
    *chat_model = chat_model.trim().to_string();

    let openrouter_key = llm_api_key.starts_with("sk-or-v1-");
    let default_openai_endpoint =
        llm_base_url.is_empty() || *llm_base_url == LEGACY_OPENAI_BASE_URL;
    if openrouter_key && default_openai_endpoint {
        *llm_base_url = OPENROUTER_BASE_URL.into();
    }
    if (openrouter_key || *llm_base_url == OPENROUTER_BASE_URL)
        && *chat_model == LEGACY_OPENAI_CHAT_MODEL
    {
        *chat_model = OPENROUTER_DEFAULT_CHAT_MODEL.into();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatus {
    pub indexed_files: u32,
    pub indexed_chunks: u32,
    pub is_indexing: bool,
    pub last_indexed_at: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub chunk_id: String,
    pub file_path: String,
    pub title: String,
    pub snippet: String,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct BackendId(String);

impl BackendId {
    pub fn new(value: impl Into<String>) -> AppResult<Self> {
        let value = value.into();
        let value = value.trim();
        if value.is_empty() {
            return Err(crate::error::AppError::msg(
                "Chat backend id must not be empty",
            ));
        }
        Ok(Self(value.to_string()))
    }

    pub fn nest() -> Self {
        Self("nest".to_string())
    }

    pub fn claude() -> Self {
        Self("claude".to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        Self::new(value.to_string())
    }
}

impl std::fmt::Display for BackendId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ChatBackendStatus {
    #[default]
    Uninitialized,
    Ready,
    Unresumable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ModelSelection {
    pub kind: ModelSelectionKind,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ModelSelectionKind {
    #[default]
    Default,
    Explicit,
}

impl ModelSelection {
    #[allow(dead_code)]
    pub fn cli_model_arg(&self) -> Option<&str> {
        match self.kind {
            ModelSelectionKind::Default => Some("default"),
            ModelSelectionKind::Explicit => self.value.as_deref(),
        }
    }

    pub fn parse(kind: &str, value: Option<&str>) -> AppResult<Self> {
        match kind {
            "default" => Ok(Self {
                kind: ModelSelectionKind::Default,
                value: None,
            }),
            "explicit" => {
                let value = value.unwrap_or_default().trim();
                if value.is_empty() {
                    return Err(crate::error::AppError::msg(
                        "explicit model selection requires a model id",
                    ));
                }
                Ok(Self {
                    kind: ModelSelectionKind::Explicit,
                    value: Some(value.to_string()),
                })
            }
            other => Err(crate::error::AppError::msg(format!(
                "Unknown model selection kind: {other}"
            ))),
        }
    }
}

impl ChatBackendStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChatBackendStatus::Uninitialized => "uninitialized",
            ChatBackendStatus::Ready => "ready",
            ChatBackendStatus::Unresumable => "unresumable",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "uninitialized" => Ok(ChatBackendStatus::Uninitialized),
            "ready" => Ok(ChatBackendStatus::Ready),
            "unresumable" => Ok(ChatBackendStatus::Unresumable),
            other => Err(crate::error::AppError::msg(format!(
                "Unknown chat backend status: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    pub archived: bool,
    /// `placeholder` | `llm` | `manual` | `local`
    pub title_source: String,
    /// `ask` | `agent`
    pub mode: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub backend: Option<BackendId>,
    #[serde(default)]
    pub backend_status: ChatBackendStatus,
    #[serde(default)]
    pub selected_backend_id: Option<String>,
    #[serde(default)]
    pub selected_model: ModelSelection,
    #[serde(default)]
    pub selection_revision: u32,
}

#[allow(dead_code)]
#[derive(Debug)]
pub struct PreparedChatTurn {
    pub session: ChatSession,
    pub user_message: ChatMessage,
    pub turn_id: String,
    pub backend: BackendId,
    pub requested_model: ModelSelection,
    pub mode: String,
}

pub const TITLE_SOURCE_PLACEHOLDER: &str = "placeholder";
pub const TITLE_SOURCE_LLM: &str = "llm";
pub const TITLE_SOURCE_MANUAL: &str = "manual";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub citations: Option<Vec<Citation>>,
    pub thinking: Option<String>,
    pub thinking_seconds: Option<f64>,
    #[serde(default)]
    pub file_changes: Vec<ChatFileChangeSummary>,
    pub created_at: String,
    #[serde(default)]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatFileChangeSummary {
    pub id: String,
    pub path: String,
    pub operation: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatFileChangeDetail {
    pub id: String,
    pub path: String,
    pub operation: String,
    pub status: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    #[serde(default)]
    pub rebase_count: i64,
    #[serde(default)]
    pub last_rebased_at: Option<String>,
    #[serde(default)]
    pub resolution_reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ClaimedChatFileChange {
    pub id: String,
    pub path: String,
    pub status: String,
    pub claim_id: String,
    pub claim_kind: String,
    pub expected_old_hash: Option<String>,
    pub expected_new_hash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewChatFileChange {
    pub path: String,
    pub operation: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub status: String,
    pub rebase_count: i64,
    pub resolution_reason: Option<String>,
}

pub struct NewChatMessage<'a> {
    pub role: &'a str,
    pub content: &'a str,
    pub citations: Option<&'a [Citation]>,
    pub thinking: Option<&'a str>,
    pub thinking_seconds: Option<f64>,
    pub file_changes: &'a [NewChatFileChange],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackMeta {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPack {
    pub pack_id: String,
    pub name: String,
    pub local_path: String,
    pub version: String,
    #[serde(default)]
    pub patch_revision: i64,
    pub last_synced: Option<String>,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub description: String,
    /// Version of an unresolved publish request for this pack, if any.
    /// `version` above stays at the last-*approved* value while this is set
    /// — the pack isn't considered "current" at the submitted version until
    /// the Hub approves it.
    #[serde(default)]
    pub pending_version: Option<String>,
    #[serde(default)]
    pub pending_request_type: Option<String>,
    #[serde(default)]
    pub pending_patch_revision: Option<i64>,
    #[serde(default)]
    pub pending_request_id: Option<String>,
    #[serde(default)]
    pub publish_review_status: Option<String>,
    #[serde(default)]
    pub publish_review_created_at: Option<String>,
    #[serde(default)]
    pub pending_can_cancel: bool,
    #[serde(default)]
    pub pending_submitter_id: Option<String>,
    #[serde(default)]
    pub pending_submitter_name: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_origin() -> String {
    "unknown".to_string()
}

pub fn open_db(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            start_offset INTEGER NOT NULL,
            end_offset INTEGER NOT NULL,
            embedding TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);

        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            chunk_id UNINDEXED,
            content,
            title,
            file_path
        );

        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            pinned INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            title_source TEXT NOT NULL DEFAULT 'placeholder',
            mode TEXT NOT NULL DEFAULT 'ask',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            citations_json TEXT,
            thinking TEXT,
            thinking_seconds REAL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chat_file_changes (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL,
            path TEXT NOT NULL,
            operation TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            old_content TEXT,
            new_content TEXT,
            FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sync_state (
            pack_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            local_path TEXT NOT NULL,
            last_synced TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            origin TEXT NOT NULL DEFAULT 'unknown'
        );

        CREATE TABLE IF NOT EXISTS chat_turns (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
            user_message_id TEXT NOT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE CASCADE,
            assistant_message_id TEXT NULL UNIQUE REFERENCES chat_messages(id) ON DELETE SET NULL,
            backend_id TEXT NOT NULL,
            requested_model_kind TEXT NOT NULL,
            requested_model_value TEXT NULL,
            effective_model TEXT NULL,
            mode TEXT NOT NULL,
            selection_revision INTEGER NOT NULL,
            status TEXT NOT NULL,
            error_code TEXT NULL,
            error_message TEXT NULL,
            warnings_json TEXT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_tool_activities (
            id TEXT PRIMARY KEY,
            turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL,
            source TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            label TEXT NOT NULL,
            target TEXT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT NULL,
            UNIQUE(turn_id, sequence)
        );

        CREATE TABLE IF NOT EXISTS index_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            indexed_files INTEGER NOT NULL DEFAULT 0,
            indexed_chunks INTEGER NOT NULL DEFAULT 0,
            last_indexed_at TEXT,
            message TEXT
        );

        INSERT OR IGNORE INTO index_meta (id, indexed_files, indexed_chunks) VALUES (1, 0, 0);
        "#,
    )?;
    ensure_chat_session_columns(conn)?;
    ensure_chat_session_backend_columns(conn)?;
    ensure_chat_file_change_columns(conn)?;
    ensure_message_thinking_columns(conn)?;
    ensure_sync_state_active_column(conn)?;
    ensure_sync_state_origin_column(conn)?;
    ensure_sync_state_owner_id_column(conn)?;
    ensure_sync_state_description_column(conn)?;
    ensure_sync_state_pending_columns(conn)?;
    ensure_sync_state_patch_columns(conn)?;
    Ok(())
}

fn ensure_chat_file_change_columns(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "chat_file_changes", "status")? {
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_file_changes", "claim_id")? {
        conn.execute("ALTER TABLE chat_file_changes ADD COLUMN claim_id TEXT", [])?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN claim_kind TEXT",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN claimed_at TEXT",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_file_changes", "failure_code")? {
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN failure_code TEXT",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN failure_message TEXT",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_file_changes", "rebase_count")? {
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN rebase_count INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN last_rebased_at TEXT",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN rebased_from_old_hash TEXT",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN rebased_from_new_hash TEXT",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN resolution_reason TEXT",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_file_changes", "apply_expected_old_hash")? {
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN apply_expected_old_hash TEXT",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN apply_expected_new_hash TEXT",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_file_changes ADD COLUMN apply_journal_json TEXT",
            [],
        )?;
    }
    Ok(())
}

fn ensure_chat_session_backend_columns(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "chat_sessions", "backend")? {
        conn.execute("ALTER TABLE chat_sessions ADD COLUMN backend TEXT", [])?;
        conn.execute(
            "UPDATE chat_sessions SET backend = 'nest' WHERE backend IS NULL",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_sessions", "backend_status")? {
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN backend_status TEXT NOT NULL DEFAULT 'uninitialized'",
            [],
        )?;
        conn.execute(
            "UPDATE chat_sessions SET backend_status = 'ready' WHERE backend IS NOT NULL",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_sessions", "selected_backend_id")? {
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN selected_backend_id TEXT",
            [],
        )?;
        conn.execute(
            "UPDATE chat_sessions SET selected_backend_id = backend WHERE backend IS NOT NULL",
            [],
        )?;
        conn.execute(
            "UPDATE chat_sessions SET selected_backend_id = 'nest' WHERE selected_backend_id IS NULL",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_sessions", "selected_model_kind")? {
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN selected_model_kind TEXT",
            [],
        )?;
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN selected_model_value TEXT",
            [],
        )?;
        conn.execute(
            "UPDATE chat_sessions
             SET selected_model_kind = CASE
                 WHEN backend = 'nest' AND ?1 != '' THEN 'explicit'
                 ELSE 'default'
             END,
             selected_model_value = CASE
                 WHEN backend = 'nest' AND ?1 != '' THEN ?1
                 ELSE NULL
             END",
            params![current_chat_model(conn)],
        )?;
    }
    if !table_has_column(conn, "chat_sessions", "selection_revision")? {
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN selection_revision INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

fn current_chat_model(conn: &Connection) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'chat_model'",
        [],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_default()
}

fn ensure_sync_state_patch_columns(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "sync_state", "patch_revision")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN patch_revision INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !table_has_column(conn, "sync_state", "pending_request_type")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN pending_request_type TEXT",
            [],
        )?;
    }
    if !table_has_column(conn, "sync_state", "pending_patch_revision")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN pending_patch_revision INTEGER",
            [],
        )?;
    }
    Ok(())
}

fn ensure_sync_state_pending_columns(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "sync_state", "pending_version")? {
        conn.execute("ALTER TABLE sync_state ADD COLUMN pending_version TEXT", [])?;
    }
    if !table_has_column(conn, "sync_state", "pending_request_id")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN pending_request_id TEXT",
            [],
        )?;
    }
    if !table_has_column(conn, "sync_state", "publish_review_status")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN publish_review_status TEXT",
            [],
        )?;
    }
    if !table_has_column(conn, "sync_state", "publish_review_created_at")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN publish_review_created_at TEXT",
            [],
        )?;
    }
    if !table_has_column(conn, "sync_state", "pending_can_cancel")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN pending_can_cancel INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !table_has_column(conn, "sync_state", "pending_submitter_id")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN pending_submitter_id TEXT",
            [],
        )?;
    }
    if !table_has_column(conn, "sync_state", "pending_submitter_name")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN pending_submitter_name TEXT",
            [],
        )?;
    }
    conn.execute(
        "UPDATE sync_state
         SET publish_review_status = 'pending'
         WHERE pending_request_id IS NOT NULL AND publish_review_status IS NULL",
        [],
    )?;
    Ok(())
}

fn ensure_sync_state_owner_id_column(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "sync_state", "owner_id")? {
        conn.execute("ALTER TABLE sync_state ADD COLUMN owner_id TEXT", [])?;
    }
    Ok(())
}

fn ensure_sync_state_description_column(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "sync_state", "description")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN description TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    Ok(())
}

fn ensure_sync_state_origin_column(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "sync_state", "origin")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN origin TEXT NOT NULL DEFAULT 'unknown'",
            [],
        )?;
    }
    Ok(())
}

fn ensure_message_thinking_columns(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "chat_messages", "thinking")? {
        conn.execute("ALTER TABLE chat_messages ADD COLUMN thinking TEXT", [])?;
    }
    if !table_has_column(conn, "chat_messages", "thinking_seconds")? {
        conn.execute(
            "ALTER TABLE chat_messages ADD COLUMN thinking_seconds REAL",
            [],
        )?;
    }
    Ok(())
}

fn ensure_sync_state_active_column(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "sync_state", "active")? {
        conn.execute(
            "ALTER TABLE sync_state ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }
    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in rows.flatten() {
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_chat_session_columns(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "chat_sessions", "pinned")? {
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_sessions", "archived")? {
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_sessions", "title_source")? {
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'placeholder'",
            [],
        )?;
    }
    if !table_has_column(conn, "chat_sessions", "mode")? {
        conn.execute(
            "ALTER TABLE chat_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'ask'",
            [],
        )?;
    }
    Ok(())
}

const SESSION_COLUMNS: &str = "id, title, pinned, archived, title_source, mode, created_at, updated_at, backend, backend_status, selected_backend_id, selected_model_kind, selected_model_value, selection_revision";

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatSession> {
    let backend_raw: Option<String> = row.get(8)?;
    let backend = backend_raw
        .map(|raw| BackendId::parse(&raw).map_err(|error| row_conversion_failure(8, error)))
        .transpose()?;
    let status_raw: String = row.get(9)?;
    let backend_status =
        ChatBackendStatus::parse(&status_raw).map_err(|error| row_conversion_failure(9, error))?;
    let selected_backend_id: Option<String> = row.get(10)?;
    let model_kind: Option<String> = row.get(11)?;
    let model_value: Option<String> = row.get(12)?;
    let selected_model = match model_kind.as_deref() {
        None => ModelSelection::default(),
        Some(kind) => ModelSelection::parse(kind, model_value.as_deref())
            .map_err(|error| row_conversion_failure(11, error))?,
    };
    Ok(ChatSession {
        id: row.get(0)?,
        title: row.get(1)?,
        pinned: row.get::<_, i64>(2)? != 0,
        archived: row.get::<_, i64>(3)? != 0,
        title_source: row.get(4)?,
        mode: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        backend,
        backend_status,
        selected_backend_id,
        selected_model,
        selection_revision: row.get(13)?,
    })
}

fn row_conversion_failure(column: usize, error: crate::error::AppError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(column, rusqlite::types::Type::Text, Box::new(error))
}

pub fn get_settings(conn: &Connection) -> AppResult<AppSettings> {
    let mut settings = AppSettings::default();
    let mut proxy_enabled_set = false;
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (key, value) = row?;
        match key.as_str() {
            "llm_base_url" => settings.llm_base_url = value,
            "llm_api_key" => settings.llm_api_key = value,
            "chat_model" => settings.chat_model = value,
            "hub_base_url" => settings.hub_base_url = value,
            "proxy_url" => settings.proxy_url = value,
            "proxy_enabled" => {
                proxy_enabled_set = true;
                settings.proxy_enabled = matches!(
                    value.trim().to_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                );
            }
            "font_size_pt" => {
                if let Ok(parsed) = value.parse::<u32>() {
                    settings.font_size_pt = parsed;
                }
            }
            "display_language" => {
                if value == "en" {
                    settings.display_language = value;
                }
            }
            // Removed account mirror. Hub authentication is the sole identity source.
            "user_name" => {}
            "knowledge_dir" => settings.knowledge_dir = value,
            "claude_agent_enabled" => {
                settings.claude_agent_enabled = matches!(
                    value.trim().to_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                );
            }
            "claude_cli_path" => settings.claude_cli_path = value,
            "claude_custom_args" => settings.claude_custom_args = value,
            "claude_custom_models" => settings.claude_custom_models = value,
            // legacy "top_k" rows ignored — retrieval uses DEFAULT_TOP_K
            _ => {}
        }
    }
    // Migrate: if a proxy URL was saved before the switch existed, keep using it.
    if !proxy_enabled_set {
        settings.proxy_enabled = !settings.proxy_url.trim().is_empty();
    }
    settings.normalize_llm_configuration();
    Ok(settings)
}

fn upsert_settings(conn: &Connection, pairs: &[(&str, String)]) -> AppResult<()> {
    for (key, value) in pairs {
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
    }
    Ok(())
}

pub fn save_general_settings(conn: &Connection, settings: &GeneralSettingsUpdate) -> AppResult<()> {
    let pairs = [
        ("llm_base_url", settings.llm_base_url.clone()),
        ("llm_api_key", settings.llm_api_key.clone()),
        ("chat_model", settings.chat_model.clone()),
        ("hub_base_url", settings.hub_base_url.clone()),
        ("proxy_url", settings.proxy_url.trim().to_string()),
        (
            "proxy_enabled",
            if settings.proxy_enabled {
                "true".into()
            } else {
                "false".into()
            },
        ),
        ("font_size_pt", settings.font_size_pt.to_string()),
        ("display_language", settings.display_language.clone()),
        ("knowledge_dir", settings.knowledge_dir.trim().to_string()),
    ];
    upsert_settings(conn, &pairs)
}

const HUB_REFRESH_TOKEN_KEY: &str = "hub_refresh_token";

/// The Hub refresh token lives in the same `settings` key/value table as
/// everything else (same storage, same guarantees as `llm_api_key`), but
/// deliberately outside the `AppSettings` struct so it's never round-tripped
/// through `settings_get`/`settings_set` and exposed to the frontend.
///
/// This replaces OS-keychain storage: on an ad-hoc-signed build (no Apple
/// Developer Team ID), macOS does not reliably persist Keychain items across
/// process launches — `SecItemAdd` can report success while the item is
/// unreadable by the very next launch of the same binary — which made the
/// Hub session silently fail to survive an app restart.
pub fn get_hub_refresh_token(conn: &Connection) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![HUB_REFRESH_TOKEN_KEY],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(AppError::from)
}

pub fn set_hub_refresh_token(conn: &Connection, token: Option<&str>) -> AppResult<()> {
    match token {
        Some(token) => {
            conn.execute(
                "INSERT INTO settings(key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![HUB_REFRESH_TOKEN_KEY, token],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM settings WHERE key = ?1",
                params![HUB_REFRESH_TOKEN_KEY],
            )?;
        }
    }
    Ok(())
}

pub fn clear_chunks(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "DELETE FROM chunks_fts; DELETE FROM chunks; UPDATE index_meta SET indexed_files = 0, indexed_chunks = 0, message = NULL WHERE id = 1;",
    )?;
    Ok(())
}

pub fn insert_chunk(
    conn: &Connection,
    id: &str,
    file_path: &str,
    title: &str,
    content: &str,
    start: usize,
    end: usize,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO chunks (id, file_path, title, content, start_offset, end_offset, embedding)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
        params![id, file_path, title, content, start as i64, end as i64],
    )?;
    conn.execute(
        "INSERT INTO chunks_fts (chunk_id, content, title, file_path) VALUES (?1, ?2, ?3, ?4)",
        params![id, content, title, file_path],
    )?;
    Ok(())
}

pub fn set_index_progress(
    conn: &Connection,
    files: u32,
    chunks: u32,
    message: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE index_meta SET indexed_files = ?1, indexed_chunks = ?2, message = ?3 WHERE id = 1",
        params![files, chunks, message],
    )?;
    Ok(())
}

pub fn set_index_complete(
    conn: &Connection,
    files: u32,
    chunks: u32,
    message: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE index_meta SET indexed_files = ?1, indexed_chunks = ?2, last_indexed_at = ?3, message = ?4 WHERE id = 1",
        params![files, chunks, Utc::now().to_rfc3339(), message],
    )?;
    Ok(())
}

pub fn set_index_message(conn: &Connection, message: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE index_meta SET message = ?1 WHERE id = 1",
        params![message],
    )?;
    Ok(())
}

pub fn get_index_status(conn: &Connection, is_indexing: bool) -> AppResult<IndexStatus> {
    conn.query_row(
        "SELECT indexed_files, indexed_chunks, last_indexed_at, message FROM index_meta WHERE id = 1",
        [],
        |row| {
            Ok(IndexStatus {
                indexed_files: row.get::<_, i64>(0)? as u32,
                indexed_chunks: row.get::<_, i64>(1)? as u32,
                is_indexing,
                last_indexed_at: row.get(2)?,
                message: row.get(3)?,
            })
        },
    )
    .map_err(Into::into)
}

fn tokenize(query: &str) -> Vec<String> {
    query
        .split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
        .map(|t| t.to_lowercase())
        .filter(|t| t.len() > 1)
        .collect()
}

fn path_in_prefixes(path: &str, prefixes: &[String]) -> bool {
    // Empty prefixes mean match nothing (caller must resolve active packs / focus).
    if prefixes.is_empty() {
        return false;
    }
    prefixes.iter().any(|s| {
        path == s || path.starts_with(&format!("{s}/")) || s.starts_with(&format!("{path}/"))
    })
}

pub fn fts_search(
    conn: &Connection,
    query: &str,
    limit: u32,
    retrieval_prefixes: &[String],
) -> AppResult<Vec<(Citation, String)>> {
    if retrieval_prefixes.is_empty() {
        return Ok(Vec::new());
    }
    let mut sql = String::from(
        "SELECT chunk_id, file_path, title, content, bm25(chunks_fts) as score
         FROM chunks_fts
         WHERE chunks_fts MATCH ?1",
    );
    sql.push_str(" AND (");
    for (i, _) in retrieval_prefixes.iter().enumerate() {
        if i > 0 {
            sql.push_str(" OR ");
        }
        sql.push_str(&format!("file_path LIKE ?{}", i + 2));
    }
    sql.push(')');
    sql.push_str(&format!(
        " ORDER BY score LIMIT ?{}",
        retrieval_prefixes.len() + 2
    ));

    let mut stmt = conn.prepare(&sql)?;
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    let fts_query = tokenize(query)
        .into_iter()
        .map(|t| format!("\"{t}\"*"))
        .collect::<Vec<_>>()
        .join(" OR ");
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }
    params_vec.push(Box::new(fts_query));
    for prefix in retrieval_prefixes {
        params_vec.push(Box::new(format!("{prefix}%")));
    }
    params_vec.push(Box::new(limit as i64));

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        let content: String = row.get(3)?;
        let bm: f64 = row.get(4)?;
        Ok((
            Citation {
                chunk_id: row.get(0)?,
                file_path: row.get(1)?,
                title: row.get(2)?,
                snippet: snippet(&content),
                score: (-bm as f32).max(0.01),
            },
            content,
        ))
    });

    match rows {
        Ok(iter) => Ok(iter.filter_map(|r| r.ok()).collect()),
        Err(_) => Ok(Vec::new()),
    }
}

/// Offline fallback: score chunks by simple term frequency overlap.
pub fn lexical_search(
    conn: &Connection,
    query: &str,
    limit: u32,
    retrieval_prefixes: &[String],
) -> AppResult<Vec<(Citation, String)>> {
    let terms = tokenize(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare("SELECT id, file_path, title, content FROM chunks")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    let mut scored: Vec<(Citation, String)> = Vec::new();
    for row in rows.flatten() {
        let (id, path, title, content) = row;
        if !path_in_prefixes(&path, retrieval_prefixes) {
            continue;
        }
        let hay = format!("{title}\n{content}").to_lowercase();
        let mut score = 0.0f32;
        for term in &terms {
            if hay.contains(term) {
                score += 1.0;
                // Prefer denser matches lightly
                score += hay.matches(term.as_str()).count() as f32 * 0.1;
            }
        }
        if score > 0.0 {
            scored.push((
                Citation {
                    chunk_id: id,
                    file_path: path,
                    title,
                    snippet: snippet(&content),
                    score,
                },
                content,
            ));
        }
    }

    scored.sort_by(|(a, _), (b, _)| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    scored.truncate(limit as usize);
    Ok(scored)
}

pub fn create_session(conn: &Connection, title: &str) -> AppResult<ChatSession> {
    let (backend, model) = default_selection_for_new_session(conn, &current_chat_model(conn));
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO chat_sessions (id, title, pinned, archived, title_source, mode, created_at, updated_at,
            selected_backend_id, selected_model_kind, selected_model_value, selection_revision)
         VALUES (?1, ?2, 0, 0, ?3, 'ask', ?4, ?5, ?6, ?7, ?8, 0)",
        params![
            id,
            title,
            TITLE_SOURCE_PLACEHOLDER,
            now,
            now,
            backend.as_str(),
            match model.kind {
                ModelSelectionKind::Default => "default",
                ModelSelectionKind::Explicit => "explicit",
            },
            model.value
        ],
    )?;
    Ok(ChatSession {
        id,
        title: title.to_string(),
        pinned: false,
        archived: false,
        title_source: TITLE_SOURCE_PLACEHOLDER.to_string(),
        mode: "ask".to_string(),
        created_at: now.clone(),
        updated_at: now,
        backend: None,
        backend_status: ChatBackendStatus::Uninitialized,
        selected_backend_id: Some(backend.as_str().to_string()),
        selected_model: model,
        selection_revision: 0,
    })
}

pub fn get_or_create_initial_session(conn: &Connection) -> AppResult<ChatSession> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLUMNS}
         FROM chat_sessions
         WHERE archived = 0
         ORDER BY pinned DESC, updated_at DESC
         LIMIT 1"
    ))?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        return Ok(map_session_row(row)?);
    }
    drop(rows);
    drop(stmt);
    create_session(conn, "New chat")
}

pub fn get_session(conn: &Connection, session_id: &str) -> AppResult<Option<ChatSession>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLUMNS}
         FROM chat_sessions WHERE id = ?1"
    ))?;
    let mut rows = stmt.query(params![session_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_session_row(row)?))
    } else {
        Ok(None)
    }
}

pub fn list_sessions(conn: &Connection) -> AppResult<Vec<ChatSession>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLUMNS}
         FROM chat_sessions
         ORDER BY pinned DESC, updated_at DESC"
    ))?;
    let rows = stmt.query_map([], map_session_row)?;
    let sessions = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(sessions)
}

pub fn list_distinct_backend_ids(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT backend FROM chat_sessions WHERE backend IS NOT NULL
         UNION SELECT DISTINCT selected_backend_id FROM chat_sessions WHERE selected_backend_id IS NOT NULL
         ORDER BY 1",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[derive(Debug, Clone, Default)]
pub struct ChatSessionUpdate {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub title_source: Option<String>,
    pub mode: Option<String>,
}

pub fn update_session(
    conn: &Connection,
    session_id: &str,
    update: ChatSessionUpdate,
) -> AppResult<ChatSession> {
    let mut current = get_session(conn, session_id)?
        .ok_or_else(|| crate::error::AppError::msg(format!("Session not found: {session_id}")))?;

    if let Some(title) = update.title {
        current.title = title;
        current.title_source = TITLE_SOURCE_MANUAL.to_string();
    }
    if let Some(source) = update.title_source {
        current.title_source = source;
    }
    if let Some(pinned) = update.pinned {
        current.pinned = pinned;
    }
    if let Some(archived) = update.archived {
        current.archived = archived;
    }
    if let Some(mode) = update.mode {
        if mode != "ask" && mode != "agent" {
            return Err(crate::error::AppError::msg("Invalid chat mode"));
        }
        current.mode = mode;
    }

    let now = Utc::now().to_rfc3339();
    current.updated_at = now.clone();

    conn.execute(
        "UPDATE chat_sessions
         SET title = ?1, pinned = ?2, archived = ?3, title_source = ?4, mode = ?5, updated_at = ?6
         WHERE id = ?7",
        params![
            current.title,
            if current.pinned { 1 } else { 0 },
            if current.archived { 1 } else { 0 },
            current.title_source,
            current.mode,
            now,
            session_id,
        ],
    )?;
    Ok(current)
}

pub fn delete_session(conn: &Connection, session_id: &str) -> AppResult<()> {
    let n = conn.execute(
        "DELETE FROM chat_sessions WHERE id = ?1",
        params![session_id],
    )?;
    if n == 0 {
        return Err(crate::error::AppError::msg(format!(
            "Session not found: {session_id}"
        )));
    }
    Ok(())
}

pub fn set_session_title_llm(
    conn: &Connection,
    session_id: &str,
    title: &str,
) -> AppResult<ChatSession> {
    let mut current = get_session(conn, session_id)?
        .ok_or_else(|| crate::error::AppError::msg(format!("Session not found: {session_id}")))?;
    if current.title_source != TITLE_SOURCE_PLACEHOLDER {
        return Ok(current);
    }
    let now = Utc::now().to_rfc3339();
    current.title = title.to_string();
    current.title_source = TITLE_SOURCE_LLM.to_string();
    current.updated_at = now.clone();
    conn.execute(
        "UPDATE chat_sessions SET title = ?1, title_source = ?2, updated_at = ?3 WHERE id = ?4",
        params![current.title, current.title_source, now, session_id],
    )?;
    Ok(current)
}

pub fn begin_chat_turn(
    conn: &mut Connection,
    session_id: &str,
    expected_revision: u32,
    content: &str,
) -> AppResult<PreparedChatTurn> {
    let tx = conn.transaction()?;
    let row = tx
        .query_row(
            "SELECT backend, selected_backend_id, selected_model_kind, selected_model_value, mode,
                    selection_revision, title_source
             FROM chat_sessions WHERE id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, u32>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((backend, selected_backend_id, model_kind, model_value, mode, revision, title_source)) =
        row
    else {
        return Err(crate::error::AppError::msg(format!(
            "Session not found: {session_id}"
        )));
    };
    if revision != expected_revision {
        return Err(crate::error::AppError::msg("chat_selection_stale"));
    }
    let selected_model = match model_kind.as_deref() {
        None => ModelSelection::default(),
        Some(kind) => ModelSelection::parse(kind, model_value.as_deref())?,
    };

    let backend = match backend.as_deref() {
        Some(persisted) => BackendId::parse(persisted)?,
        None => {
            let requested = selected_backend_id
                .as_deref()
                .and_then(|value| BackendId::parse(value).ok())
                .unwrap_or_else(BackendId::nest);
            let initial_status = if requested.as_str() == "nest" {
                ChatBackendStatus::Ready
            } else {
                ChatBackendStatus::Uninitialized
            };
            tx.execute(
                "UPDATE chat_sessions
                 SET backend = ?1, backend_status = ?2, selected_backend_id = ?1
                 WHERE id = ?3 AND backend IS NULL",
                params![requested.as_str(), initial_status.as_str(), session_id],
            )?;
            if title_source == TITLE_SOURCE_PLACEHOLDER && requested.as_str() == "claude" {
                let title = local_session_title(content);
                tx.execute(
                    "UPDATE chat_sessions SET title = ?1, title_source = ?2 WHERE id = ?3",
                    params![title, TITLE_SOURCE_LOCAL, session_id],
                )?;
            }
            requested
        }
    };

    let message_id = Uuid::new_v4().to_string();
    let turn_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO chat_messages (id, session_id, role, content, citations_json, thinking, thinking_seconds, created_at)
         VALUES (?1, ?2, 'user', ?3, '', NULL, NULL, ?4)",
        params![message_id, session_id, content, now],
    )?;
    tx.execute(
        "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )?;
    tx.execute(
        "INSERT INTO chat_turns (id, session_id, user_message_id, backend_id,
            requested_model_kind, requested_model_value, mode, selection_revision, status, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'running', ?9)",
        params![
            turn_id,
            session_id,
            message_id,
            backend.as_str(),
            match selected_model.kind {
                ModelSelectionKind::Default => "default",
                ModelSelectionKind::Explicit => "explicit",
            },
            selected_model.value,
            mode,
            revision,
            now
        ],
    )?;
    tx.commit()?;

    let session = get_session(conn, session_id)?
        .ok_or_else(|| crate::error::AppError::msg(format!("Session not found: {session_id}")))?;
    Ok(PreparedChatTurn {
        session,
        user_message: ChatMessage {
            id: message_id,
            role: "user".into(),
            content: content.to_string(),
            citations: None,
            thinking: None,
            thinking_seconds: None,
            file_changes: Vec::new(),
            created_at: now,
            turn_id: Some(turn_id.clone()),
        },
        turn_id,
        backend,
        requested_model: selected_model,
        mode,
    })
}

pub fn finish_chat_turn(
    conn: &Connection,
    turn_id: &str,
    status: &str,
    effective_model: Option<&str>,
    assistant_message_id: Option<&str>,
    error_code: Option<&str>,
    error_message: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE chat_turns
         SET status = ?1, effective_model = ?2, error_code = ?3, error_message = ?4,
             assistant_message_id = ?5, finished_at = ?6
         WHERE id = ?7 AND status = 'running'",
        params![
            status,
            effective_model,
            error_code,
            error_message,
            assistant_message_id,
            Utc::now().to_rfc3339(),
            turn_id
        ],
    )?;
    Ok(())
}

pub fn set_chat_turn_warnings(
    conn: &Connection,
    turn_id: &str,
    warnings: &[String],
) -> AppResult<()> {
    let value = if warnings.is_empty() {
        None
    } else {
        Some(serde_json::to_string(warnings)?)
    };
    conn.execute(
        "UPDATE chat_turns SET warnings_json = ?1 WHERE id = ?2",
        params![value, turn_id],
    )?;
    Ok(())
}

pub fn commit_assistant_and_finish_turn(
    conn: &mut Connection,
    turn_id: &str,
    session_id: &str,
    status: &str,
    effective_model: Option<&str>,
    message: NewChatMessage<'_>,
) -> AppResult<ChatMessage> {
    let tx = conn.transaction()?;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let citations_json = message
        .citations
        .map(serde_json::to_string)
        .transpose()?
        .unwrap_or_default();
    tx.execute(
        "INSERT INTO chat_messages (id, session_id, role, content, citations_json, thinking, thinking_seconds, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, session_id, message.role, message.content, citations_json, message.thinking, message.thinking_seconds, now],
    )?;
    let mut summaries = Vec::with_capacity(message.file_changes.len());
    for change in message.file_changes {
        let change_id = Uuid::new_v4().to_string();
        tx.execute(
            "UPDATE chat_file_changes SET status = 'rejected' WHERE path = ?1 AND status IN ('pending', 'conflicted')",
            params![change.path],
        )?;
        if change.old_content == change.new_content {
            continue;
        }
        tx.execute(
            "INSERT INTO chat_file_changes (id, message_id, path, operation, status, old_content, new_content, rebase_count, last_rebased_at, resolution_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CASE WHEN ?8 > 0 THEN ?9 ELSE NULL END, ?10)",
            params![change_id, id, change.path, change.operation, change.status, change.old_content, change.new_content, change.rebase_count, now, change.resolution_reason],
        )?;
        summaries.push(ChatFileChangeSummary {
            id: change_id,
            path: change.path.clone(),
            operation: change.operation.to_string(),
            status: change.status.clone(),
        });
    }
    tx.execute(
        "UPDATE chat_turns
         SET status = ?1, effective_model = ?2, assistant_message_id = ?3, finished_at = ?4
         WHERE id = ?5 AND status = 'running'",
        params![status, effective_model, id, now, turn_id],
    )?;
    tx.commit()?;
    Ok(ChatMessage {
        id,
        role: message.role.to_string(),
        content: message.content.to_string(),
        citations: message.citations.map(|c| c.to_vec()),
        thinking: message.thinking.map(str::to_string),
        thinking_seconds: message.thinking_seconds,
        file_changes: summaries,
        created_at: now,
        turn_id: None,
    })
}

#[allow(dead_code)]
pub fn set_session_backend_status(
    conn: &Connection,
    session_id: &str,
    status: ChatBackendStatus,
) -> AppResult<ChatSession> {
    let n = conn.execute(
        "UPDATE chat_sessions SET backend_status = ?1 WHERE id = ?2",
        params![status.as_str(), session_id],
    )?;
    if n == 0 {
        return Err(crate::error::AppError::msg(format!(
            "Session not found: {session_id}"
        )));
    }
    get_session(conn, session_id)?
        .ok_or_else(|| crate::error::AppError::msg(format!("Session not found: {session_id}")))
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeConnectionStatus {
    Disabled,
    Connected,
    LastConnected,
    #[default]
    Unavailable,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClaudeConnectionReport {
    pub status: ClaudeConnectionStatus,
    pub configured_cli_path: String,
    #[serde(default)]
    pub configured_cli_args: String,
    pub resolved_cli_path: String,
    pub cli_version: String,
    pub effective_model: String,
    pub tested_at: String,
    pub message: Option<String>,
}

impl ClaudeConnectionReport {
    pub fn matches_configured(&self, current_cli_path: &str, current_cli_args: &str) -> bool {
        self.configured_cli_path == current_cli_path.trim()
            && self.configured_cli_args == current_cli_args.trim()
    }
}

const CLAUDE_CONNECTION_REPORT_KEY: &str = "claude_connection_report_v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeModelOption {
    pub model_id: String,
    pub source: ClaudeModelSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaudeModelSource {
    Default,
    Custom,
}

impl ClaudeModelSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            ClaudeModelSource::Default => "default",
            ClaudeModelSource::Custom => "custom",
        }
    }
}

pub fn claude_model_options(custom_models: &str) -> Vec<ClaudeModelOption> {
    let mut options = vec![ClaudeModelOption {
        model_id: String::new(),
        source: ClaudeModelSource::Default,
    }];
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in custom_models.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || seen.contains(trimmed) {
            continue;
        }
        seen.insert(trimmed.to_string());
        options.push(ClaudeModelOption {
            model_id: trimmed.to_string(),
            source: ClaudeModelSource::Custom,
        });
    }
    options
}

pub fn save_claude_connection_report(
    conn: &Connection,
    report: &ClaudeConnectionReport,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![CLAUDE_CONNECTION_REPORT_KEY, serde_json::to_string(report)?],
    )?;
    Ok(())
}

pub fn load_claude_connection_report(conn: &Connection) -> Option<ClaudeConnectionReport> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![CLAUDE_CONNECTION_REPORT_KEY],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|value| serde_json::from_str(&value).ok())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ClaudeModelStatusEntry {
    #[serde(default)]
    pub configured_cli_path: Option<String>,
    #[serde(default)]
    pub configured_cli_args: Option<String>,
    pub ok: bool,
    pub message: Option<String>,
    pub tested_at: String,
}

impl ClaudeModelStatusEntry {
    pub fn matches_configured(&self, current_cli_path: &str, current_cli_args: &str) -> bool {
        self.configured_cli_path
            .as_deref()
            .is_some_and(|path| path == current_cli_path.trim())
            && self.configured_cli_args.as_deref().unwrap_or_default() == current_cli_args.trim()
    }
}

const CLAUDE_MODEL_STATUS_KEY: &str = "claude_model_status_v1";
const CLAUDE_MODEL_STATUS_SEPARATOR: char = '\u{1f}';

fn claude_model_status_key(
    configured_cli_path: &str,
    configured_cli_args: &str,
    model: &str,
) -> String {
    format!(
        "{}{}{}{}{}",
        configured_cli_path.trim(),
        CLAUDE_MODEL_STATUS_SEPARATOR,
        configured_cli_args.trim(),
        CLAUDE_MODEL_STATUS_SEPARATOR,
        model.trim()
    )
}

pub fn model_status_for_configured_path<'a>(
    statuses: &'a std::collections::HashMap<String, ClaudeModelStatusEntry>,
    configured_cli_path: &str,
    configured_cli_args: &str,
    model: &str,
) -> Option<&'a ClaudeModelStatusEntry> {
    statuses
        .get(&claude_model_status_key(
            configured_cli_path,
            configured_cli_args,
            model,
        ))
        .filter(|entry| entry.matches_configured(configured_cli_path, configured_cli_args))
}

pub fn model_statuses_for_configured_path(
    statuses: &std::collections::HashMap<String, ClaudeModelStatusEntry>,
    configured_cli_path: &str,
    configured_cli_args: &str,
) -> std::collections::HashMap<String, ClaudeModelStatusEntry> {
    let prefix = format!(
        "{}{}{}{}",
        configured_cli_path.trim(),
        CLAUDE_MODEL_STATUS_SEPARATOR,
        configured_cli_args.trim(),
        CLAUDE_MODEL_STATUS_SEPARATOR
    );
    statuses
        .iter()
        .filter_map(|(key, entry)| {
            key.strip_prefix(&prefix)
                .filter(|_| entry.matches_configured(configured_cli_path, configured_cli_args))
                .map(|model| (model.to_string(), entry.clone()))
        })
        .collect()
}

pub fn load_claude_model_statuses(
    conn: &Connection,
) -> AppResult<std::collections::HashMap<String, ClaudeModelStatusEntry>> {
    let value = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![CLAUDE_MODEL_STATUS_KEY],
            |row| row.get::<_, String>(0),
        )
        .ok();
    match value {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(std::collections::HashMap::new()),
    }
}

pub fn save_claude_model_statuses(
    conn: &Connection,
    statuses: &std::collections::HashMap<String, ClaudeModelStatusEntry>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![CLAUDE_MODEL_STATUS_KEY, serde_json::to_string(statuses)?],
    )?;
    Ok(())
}

pub fn upsert_claude_model_status(
    conn: &Connection,
    model: &str,
    entry: &ClaudeModelStatusEntry,
) -> AppResult<()> {
    let mut statuses = load_claude_model_statuses(conn)?;
    statuses.remove(model.trim());
    statuses.insert(
        claude_model_status_key(
            entry.configured_cli_path.as_deref().unwrap_or_default(),
            entry.configured_cli_args.as_deref().unwrap_or_default(),
            model,
        ),
        entry.clone(),
    );
    save_claude_model_statuses(conn, &statuses)
}

pub fn prune_claude_model_statuses(conn: &Connection, custom_models: &str) -> AppResult<()> {
    let mut statuses = load_claude_model_statuses(conn)?;
    if statuses.is_empty() {
        return Ok(());
    }
    let kept: std::collections::HashSet<String> = custom_models
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    let before = statuses.len();
    statuses.retain(|key, _| {
        let model = key
            .rsplit_once(CLAUDE_MODEL_STATUS_SEPARATOR)
            .map_or(key.as_str(), |(_, model)| model);
        kept.contains(model)
    });
    if statuses.len() != before {
        save_claude_model_statuses(conn, &statuses)?;
    }
    Ok(())
}

pub fn connection_proven_from(
    enabled: bool,
    configured_cli_path: &str,
    configured_cli_args: &str,
    memory: Option<&ClaudeConnectionReport>,
    persisted: Option<&ClaudeConnectionReport>,
) -> bool {
    if !enabled {
        return false;
    }
    if let Some(report) = memory {
        if report.matches_configured(configured_cli_path, configured_cli_args) {
            return report.status == ClaudeConnectionStatus::Connected;
        }
    }
    persisted.is_some_and(|report| {
        report.status == ClaudeConnectionStatus::Connected
            && report.matches_configured(configured_cli_path, configured_cli_args)
    })
}

#[allow(dead_code)]
pub fn normalize_claude_custom_models(input: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut lines = Vec::new();
    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            lines.push(trimmed.to_string());
        }
    }
    lines.join("\n")
}

pub const TITLE_SOURCE_LOCAL: &str = "local";

pub fn local_session_title(first_user_message: &str) -> String {
    let collapsed: String = first_user_message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        return "New chat".to_string();
    }
    let count = trimmed.chars().count();
    if count <= 48 {
        return trimmed.to_string();
    }
    let mut shown: String = trimmed.chars().take(48).collect();
    shown.push('…');
    shown
}

#[derive(Debug, Clone, Default)]
pub struct SelectionPatch {
    pub selected_backend_id: Option<BackendId>,
    pub selected_model: Option<ModelSelection>,
    pub mode: Option<String>,
}

pub fn update_session_selection(
    conn: &Connection,
    session_id: &str,
    expected_revision: u32,
    patch: SelectionPatch,
) -> AppResult<ChatSession> {
    let current = get_session(conn, session_id)?
        .ok_or_else(|| crate::error::AppError::msg(format!("Session not found: {session_id}")))?;
    if current.selection_revision != expected_revision {
        return Err(crate::error::AppError::msg("chat_selection_stale"));
    }
    if let Some(mode) = patch.mode.as_deref() {
        if mode != "ask" && mode != "agent" {
            return Err(crate::error::AppError::msg("Invalid chat mode"));
        }
    }
    let mut selected_backend_id = current.selected_backend_id.clone();
    if let Some(backend) = patch.selected_backend_id {
        if current.backend.is_some() {
            return Err(crate::error::AppError::msg(
                "chat_backend_bound: create a new chat to switch backends",
            ));
        }
        selected_backend_id = Some(backend.as_str().to_string());
    }
    let selected_model = patch.selected_model.unwrap_or(current.selected_model);
    let mode = patch.mode.unwrap_or(current.mode);
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_sessions
         SET selected_backend_id = ?1, selected_model_kind = ?2, selected_model_value = ?3,
             mode = ?4, selection_revision = selection_revision + 1, updated_at = ?5
         WHERE id = ?6 AND selection_revision = ?7",
        params![
            selected_backend_id,
            match selected_model.kind {
                ModelSelectionKind::Default => "default",
                ModelSelectionKind::Explicit => "explicit",
            },
            selected_model.value,
            mode,
            now,
            session_id,
            expected_revision
        ],
    )?;
    get_session(conn, session_id)?
        .ok_or_else(|| crate::error::AppError::msg(format!("Session not found: {session_id}")))
}

#[allow(dead_code)]
pub fn default_selection_for_new_session(
    conn: &Connection,
    current_chat_model: &str,
) -> (BackendId, ModelSelection) {
    let mut stmt = match conn.prepare(
        "SELECT backend, selected_backend_id, selected_model_kind, selected_model_value
         FROM chat_sessions
         ORDER BY created_at DESC, id DESC
         LIMIT 1",
    ) {
        Ok(stmt) => stmt,
        Err(_) => return (BackendId::nest(), ModelSelection::default()),
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    });
    let rows = match rows {
        Ok(rows) => rows,
        Err(_) => return (BackendId::nest(), ModelSelection::default()),
    };
    if let Some(row) = rows.flatten().next() {
        let (backend, selected_backend, model_kind, model_value) = row;
        let backend_id = backend
            .as_deref()
            .and_then(|value| BackendId::parse(value).ok())
            .or_else(|| {
                selected_backend
                    .as_deref()
                    .and_then(|value| BackendId::parse(value).ok())
            })
            .unwrap_or_else(BackendId::nest);
        let model = match model_kind.as_deref() {
            Some("explicit") => {
                ModelSelection::parse("explicit", model_value.as_deref()).unwrap_or_default()
            }
            _ => {
                if backend_id.as_str() == "nest" && !current_chat_model.trim().is_empty() {
                    ModelSelection {
                        kind: ModelSelectionKind::Explicit,
                        value: Some(current_chat_model.trim().to_string()),
                    }
                } else {
                    ModelSelection::default()
                }
            }
        };
        return (backend_id, model);
    }
    let model = if !current_chat_model.trim().is_empty() {
        ModelSelection {
            kind: ModelSelectionKind::Explicit,
            value: Some(current_chat_model.trim().to_string()),
        }
    } else {
        ModelSelection::default()
    };
    (BackendId::nest(), model)
}

#[allow(dead_code)]
pub fn save_claude_settings(
    conn: &Connection,
    enabled: bool,
    cli_path: &str,
    custom_args: &str,
    custom_models: &str,
) -> AppResult<()> {
    let pairs = [
        (
            "claude_agent_enabled",
            if enabled {
                "true".into()
            } else {
                "false".into()
            },
        ),
        ("claude_cli_path", cli_path.trim().to_string()),
        ("claude_custom_args", custom_args.trim().to_string()),
        (
            "claude_custom_models",
            normalize_claude_custom_models(custom_models),
        ),
    ];
    upsert_settings(conn, &pairs)?;
    prune_claude_model_statuses(conn, &normalize_claude_custom_models(custom_models))
}

#[allow(dead_code)]
pub fn add_message(
    conn: &mut Connection,
    session_id: &str,
    message: NewChatMessage<'_>,
) -> AppResult<ChatMessage> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let citations_json = message
        .citations
        .map(serde_json::to_string)
        .transpose()?
        .unwrap_or_default();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO chat_messages (id, session_id, role, content, citations_json, thinking, thinking_seconds, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, session_id, message.role, message.content, citations_json, message.thinking, message.thinking_seconds, now],
    )?;
    let mut summaries = Vec::with_capacity(message.file_changes.len());
    for change in message.file_changes {
        let change_id = Uuid::new_v4().to_string();
        tx.execute(
            "UPDATE chat_file_changes SET status = 'rejected' WHERE path = ?1 AND status IN ('pending', 'conflicted')",
            params![change.path],
        )?;
        // A follow-up Agent turn may intentionally restore the original disk
        // state (for example, deleting a still-pending creation). Supersede
        // the earlier proposal above, but do not create another no-op review.
        if change.old_content == change.new_content {
            continue;
        }
        tx.execute(
            "INSERT INTO chat_file_changes (id, message_id, path, operation, status, old_content, new_content, rebase_count, last_rebased_at, resolution_reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CASE WHEN ?8 > 0 THEN ?9 ELSE NULL END, ?10)",
            params![
                change_id,
                id,
                change.path,
                change.operation,
                change.status,
                change.old_content,
                change.new_content,
                change.rebase_count,
                now,
                change.resolution_reason,
            ],
        )?;
        summaries.push(ChatFileChangeSummary {
            id: change_id,
            path: change.path.clone(),
            operation: change.operation.clone(),
            status: change.status.clone(),
        });
    }
    tx.execute(
        "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )?;
    tx.commit()?;
    Ok(ChatMessage {
        id,
        role: message.role.to_string(),
        content: message.content.to_string(),
        citations: message.citations.map(|c| c.to_vec()),
        thinking: message.thinking.map(str::to_string),
        thinking_seconds: message.thinking_seconds,
        file_changes: summaries,
        created_at: now,
        turn_id: None,
    })
}

pub fn list_messages(conn: &Connection, session_id: &str) -> AppResult<Vec<ChatMessage>> {
    let mut stmt = conn.prepare(
        "SELECT m.id, m.role, m.content, m.citations_json, m.thinking, m.thinking_seconds, m.created_at,
                (SELECT t.id FROM chat_turns t WHERE t.user_message_id = m.id OR t.assistant_message_id = m.id LIMIT 1)
         FROM chat_messages m
         WHERE m.session_id = ?1 ORDER BY m.created_at ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        let citations_json: String = row.get(3)?;
        let citations = if citations_json.is_empty() {
            None
        } else {
            serde_json::from_str(&citations_json).ok()
        };
        Ok(ChatMessage {
            id: row.get(0)?,
            role: row.get(1)?,
            content: row.get(2)?,
            citations,
            thinking: row.get(4)?,
            thinking_seconds: row.get(5)?,
            file_changes: Vec::new(),
            created_at: row.get(6)?,
            turn_id: row.get(7)?,
        })
    })?;
    let mut messages = rows.collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    for message in &mut messages {
        message.file_changes = list_file_change_summaries(conn, &message.id)?;
    }
    Ok(messages)
}

fn list_file_change_summaries(
    conn: &Connection,
    message_id: &str,
) -> AppResult<Vec<ChatFileChangeSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, operation, status FROM chat_file_changes WHERE message_id = ?1 ORDER BY path",
    )?;
    let rows = stmt.query_map(params![message_id], |row| {
        Ok(ChatFileChangeSummary {
            id: row.get(0)?,
            path: row.get(1)?,
            operation: row.get(2)?,
            status: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_chat_file_change(conn: &Connection, change_id: &str) -> AppResult<ChatFileChangeDetail> {
    conn.query_row(
        "SELECT id, path, operation, status, old_content, new_content, rebase_count, last_rebased_at, resolution_reason FROM chat_file_changes WHERE id = ?1",
        params![change_id],
        |row| {
            Ok(ChatFileChangeDetail {
                id: row.get(0)?,
                path: row.get(1)?,
                operation: row.get(2)?,
                status: row.get(3)?,
                old_content: row.get(4)?,
                new_content: row.get(5)?,
                rebase_count: row.get(6)?,
                last_rebased_at: row.get(7)?,
                resolution_reason: row.get(8)?,
            })
        },
    )
    .map_err(|_| crate::error::AppError::msg("Chat file change not found"))
}

pub fn get_pending_chat_file_change_for_path(
    conn: &Connection,
    path: &str,
) -> AppResult<Option<ChatFileChangeDetail>> {
    conn.query_row(
        "SELECT id, path, operation, status, old_content, new_content, rebase_count, last_rebased_at, resolution_reason
         FROM chat_file_changes
         WHERE path = ?1 AND status IN ('pending', 'conflicted')
         ORDER BY rowid DESC LIMIT 1",
        params![path],
        |row| {
            Ok(ChatFileChangeDetail {
                id: row.get(0)?,
                path: row.get(1)?,
                operation: row.get(2)?,
                status: row.get(3)?,
                old_content: row.get(4)?,
                new_content: row.get(5)?,
                rebase_count: row.get(6)?,
                last_rebased_at: row.get(7)?,
                resolution_reason: row.get(8)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

pub fn list_pending_chat_file_changes(conn: &Connection) -> AppResult<Vec<ChatFileChangeDetail>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, operation, status, old_content, new_content, rebase_count, last_rebased_at, resolution_reason
         FROM chat_file_changes WHERE status = 'pending' ORDER BY rowid",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ChatFileChangeDetail {
            id: row.get(0)?,
            path: row.get(1)?,
            operation: row.get(2)?,
            status: row.get(3)?,
            old_content: row.get(4)?,
            new_content: row.get(5)?,
            rebase_count: row.get(6)?,
            last_rebased_at: row.get(7)?,
            resolution_reason: row.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn list_claimed_chat_file_changes(conn: &Connection) -> AppResult<Vec<ClaimedChatFileChange>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, status, claim_id, claim_kind,
                apply_expected_old_hash, apply_expected_new_hash
         FROM chat_file_changes
         WHERE status IN ('applying', 'rebasing') AND claim_id IS NOT NULL
         ORDER BY rowid",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ClaimedChatFileChange {
            id: row.get(0)?,
            path: row.get(1)?,
            status: row.get(2)?,
            claim_id: row.get(3)?,
            claim_kind: row.get(4)?,
            expected_old_hash: row.get(5)?,
            expected_new_hash: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn approve_chat_file_change(
    conn: &Connection,
    change_id: &str,
    claim_id: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE chat_file_changes
         SET status = 'approved', claim_id = NULL, claim_kind = NULL, claimed_at = NULL,
             apply_journal_json = NULL
         WHERE id = ?1 AND status = 'applying' AND claim_id = ?2 AND claim_kind = 'apply'",
        params![change_id, claim_id],
    )?;
    if changed == 0 {
        return Err(crate::error::AppError::msg(
            "File change is no longer pending",
        ));
    }
    Ok(())
}

pub fn set_chat_file_change_status(
    conn: &Connection,
    change_id: &str,
    status: &str,
) -> AppResult<()> {
    if status != "approved" && status != "rejected" {
        return Err(crate::error::AppError::msg("Invalid file-change status"));
    }
    let changed = conn.execute(
        "UPDATE chat_file_changes SET status = ?1
         WHERE id = ?2 AND (status = 'pending' OR (status = 'conflicted' AND ?1 = 'rejected'))",
        params![status, change_id],
    )?;
    if changed == 0 {
        return Err(crate::error::AppError::msg(
            "File change is no longer pending",
        ));
    }
    Ok(())
}

pub fn claim_chat_file_change(
    conn: &Connection,
    change_id: &str,
    claim_id: &str,
    claim_kind: &str,
    expected_old_hash: Option<&str>,
    expected_new_hash: Option<&str>,
) -> AppResult<()> {
    if claim_kind != "apply" && claim_kind != "rebase" {
        return Err(crate::error::AppError::msg("Invalid proposal claim kind"));
    }
    let status = if claim_kind == "apply" {
        "applying"
    } else {
        "rebasing"
    };
    let changed = conn.execute(
        "UPDATE chat_file_changes
         SET status = ?1, claim_id = ?2, claim_kind = ?3, claimed_at = ?4,
             apply_expected_old_hash = ?5, apply_expected_new_hash = ?6,
             apply_journal_json = ?7
         WHERE id = ?8 AND status = 'pending' AND claim_id IS NULL",
        params![
            status,
            claim_id,
            claim_kind,
            Utc::now().to_rfc3339(),
            expected_old_hash,
            expected_new_hash,
            serde_json::json!({ "phase": "claimed" }).to_string(),
            change_id
        ],
    )?;
    if changed == 0 {
        return Err(crate::error::AppError::msg(
            "File change is no longer pending",
        ));
    }
    Ok(())
}

pub fn rebase_chat_file_change(
    conn: &Connection,
    change_id: &str,
    new_old_content: Option<&str>,
    new_new_content: Option<&str>,
    old_hash: &str,
    new_hash: &str,
    claim_id: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE chat_file_changes
         SET old_content = ?1, new_content = ?2,
             rebase_count = rebase_count + 1,
             last_rebased_at = ?3,
             rebased_from_old_hash = ?4,
             rebased_from_new_hash = ?5,
             status = 'pending', claim_id = NULL, claim_kind = NULL, claimed_at = NULL,
             apply_journal_json = NULL
         WHERE id = ?6 AND status = 'rebasing' AND claim_id = ?7 AND claim_kind = 'rebase'",
        params![
            new_old_content,
            new_new_content,
            Utc::now().to_rfc3339(),
            old_hash,
            new_hash,
            change_id,
            claim_id
        ],
    )?;
    ensure_claim_updated(changed)?;
    Ok(())
}

pub fn resolve_chat_file_change_externally(
    conn: &Connection,
    change_id: &str,
    reason: &str,
    claim_id: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE chat_file_changes
         SET status = 'resolved_external', resolution_reason = ?1,
             claim_id = NULL, claim_kind = NULL, claimed_at = NULL, apply_journal_json = NULL
         WHERE id = ?2 AND status = 'rebasing' AND claim_id = ?3 AND claim_kind = 'rebase'",
        params![reason, change_id, claim_id],
    )?;
    ensure_claim_updated(changed)?;
    Ok(())
}

pub fn conflict_chat_file_change(
    conn: &Connection,
    change_id: &str,
    reason: &str,
    claim_id: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE chat_file_changes
         SET status = 'conflicted', resolution_reason = ?1,
             claim_id = NULL, claim_kind = NULL, claimed_at = NULL, apply_journal_json = NULL
         WHERE id = ?2 AND status = 'rebasing' AND claim_id = ?3 AND claim_kind = 'rebase'",
        params![reason, change_id, claim_id],
    )?;
    ensure_claim_updated(changed)?;
    Ok(())
}

pub fn conflict_claimed_chat_file_change(
    conn: &Connection,
    change_id: &str,
    reason: &str,
    claim_id: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE chat_file_changes
         SET status = 'conflicted', resolution_reason = ?1,
             claim_id = NULL, claim_kind = NULL, claimed_at = NULL, apply_journal_json = NULL
         WHERE id = ?2 AND status IN ('applying', 'rebasing') AND claim_id = ?3",
        params![reason, change_id, claim_id],
    )?;
    ensure_claim_updated(changed)
}

fn ensure_claim_updated(changed: usize) -> AppResult<()> {
    if changed == 0 {
        return Err(crate::error::AppError::msg(
            "proposal_claim_lost: proposal claim is no longer owned by this operation",
        ));
    }
    Ok(())
}

pub fn mark_chat_file_change_written(
    conn: &Connection,
    change_id: &str,
    claim_id: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE chat_file_changes SET apply_journal_json = ?1
         WHERE id = ?2 AND status = 'applying' AND claim_id = ?3 AND claim_kind = 'apply'",
        params![
            serde_json::json!({ "phase": "written" }).to_string(),
            change_id,
            claim_id
        ],
    )?;
    ensure_claim_updated(changed)
}

pub fn fail_chat_file_change(
    conn: &Connection,
    change_id: &str,
    failure_code: &str,
    failure_message: &str,
    claim_id: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE chat_file_changes
         SET status = 'failed', failure_code = ?1, failure_message = ?2,
             claim_id = NULL, claim_kind = NULL, claimed_at = NULL, apply_journal_json = NULL
         WHERE id = ?3 AND status = 'applying' AND claim_id = ?4 AND claim_kind = 'apply'",
        params![failure_code, failure_message, change_id, claim_id],
    )?;
    ensure_claim_updated(changed)
}

pub fn release_chat_file_change_claim(
    conn: &Connection,
    change_id: &str,
    claim_id: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE chat_file_changes
         SET status = 'pending', claim_id = NULL, claim_kind = NULL, claimed_at = NULL,
             apply_journal_json = NULL
         WHERE id = ?1 AND claim_id = ?2 AND status IN ('applying', 'rebasing')",
        params![change_id, claim_id],
    )?;
    ensure_claim_updated(changed)
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolActivityRow {
    pub id: String,
    pub turn_id: String,
    pub sequence: i64,
    pub source: String,
    pub kind: String,
    pub status: String,
    pub label: String,
    pub target: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

pub fn insert_tool_activity(
    conn: &Connection,
    turn_id: &str,
    sequence: i64,
    source: &str,
    kind: &str,
    label: &str,
    target: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO chat_tool_activities
            (id, turn_id, sequence, source, kind, status, label, target, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6, ?7, ?8)",
        params![
            uuid::Uuid::new_v4().to_string(),
            turn_id,
            sequence,
            source,
            kind,
            label,
            target,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

#[allow(dead_code)]
pub fn finish_tool_activity(
    conn: &Connection,
    turn_id: &str,
    sequence: i64,
    status: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE chat_tool_activities
         SET status = ?1, finished_at = ?2
         WHERE turn_id = ?3 AND sequence = ?4",
        params![status, Utc::now().to_rfc3339(), turn_id, sequence],
    )?;
    Ok(())
}

pub fn finalize_running_tool_activities(
    conn: &Connection,
    turn_id: &str,
    status: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE chat_tool_activities
         SET status = ?1, finished_at = ?2
         WHERE turn_id = ?3 AND status = 'running'",
        params![status, Utc::now().to_rfc3339(), turn_id],
    )?;
    Ok(())
}

pub fn recover_interrupted_turns(conn: &Connection) -> AppResult<usize> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE chat_turns
         SET status = 'interrupted',
             error_code = COALESCE(error_code, 'app_shutdown'),
             finished_at = COALESCE(finished_at, ?1)
         WHERE status = 'running'",
        params![now],
    )?;
    let count = conn.execute(
        "UPDATE chat_tool_activities
         SET status = 'interrupted', finished_at = ?1
         WHERE status = 'running'
           AND turn_id IN (SELECT id FROM chat_turns WHERE status = 'interrupted')",
        params![now],
    )?;
    Ok(count)
}

pub fn list_tool_activities(conn: &Connection, turn_id: &str) -> AppResult<Vec<ToolActivityRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, turn_id, sequence, source, kind, status, label, target, started_at, finished_at
         FROM chat_tool_activities
         WHERE turn_id = ?1
         ORDER BY sequence ASC",
    )?;
    let rows = stmt.query_map(params![turn_id], |row| {
        Ok(ToolActivityRow {
            id: row.get(0)?,
            turn_id: row.get(1)?,
            sequence: row.get(2)?,
            source: row.get(3)?,
            kind: row.get(4)?,
            status: row.get(5)?,
            label: row.get(6)?,
            target: row.get(7)?,
            started_at: row.get(8)?,
            finished_at: row.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Parameters for `upsert_sync_state` — grouped into a struct since the
/// individual-arguments form grew past clippy's arity lint as ownership and
/// description tracking were added.
pub struct SyncStateUpsert<'a> {
    pub pack_id: &'a str,
    pub name: &'a str,
    pub version: &'a str,
    pub local_path: &'a str,
    pub origin: &'a str,
    pub owner_id: Option<&'a str>,
    pub description: &'a str,
    pub patch_revision: i64,
}

pub fn upsert_sync_state(conn: &Connection, values: SyncStateUpsert<'_>) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    // Preserve active flag on upgrade; new packs default to active=1.
    // owner_id is only overwritten when the caller actually knows it — a
    // re-sync/import that doesn't have owner info shouldn't clobber a
    // previously-recorded owner with NULL.
    conn.execute(
        "INSERT INTO sync_state (pack_id, name, version, local_path, last_synced, active, origin, owner_id, description, patch_revision)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9)
         ON CONFLICT(pack_id) DO UPDATE SET
           name = excluded.name,
           version = excluded.version,
           local_path = excluded.local_path,
           last_synced = excluded.last_synced,
           origin = excluded.origin,
           owner_id = COALESCE(excluded.owner_id, sync_state.owner_id),
           description = excluded.description,
           patch_revision = excluded.patch_revision",
        params![
            values.pack_id,
            values.name,
            values.version,
            values.local_path,
            now,
            values.origin,
            values.owner_id,
            values.description,
            values.patch_revision
        ],
    )?;
    Ok(())
}

pub fn set_pack_active(conn: &Connection, pack_id: &str, active: bool) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE sync_state SET active = ?1 WHERE pack_id = ?2 OR local_path = ?2",
        params![if active { 1 } else { 0 }, pack_id],
    )?;
    if n == 0 {
        return Err(AppError::msg(format!("Pack not installed: {pack_id}")));
    }
    Ok(())
}

pub fn list_active_pack_roots(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT local_path FROM sync_state WHERE active = 1 ORDER BY local_path")?;
    let rows = stmt.query_map([], |row| row.get(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

const INSTALLED_PACK_SELECT: &str = "SELECT pack_id, name, local_path, version, last_synced, COALESCE(active, 1), COALESCE(origin, 'unknown'), owner_id, COALESCE(description, ''), pending_version, pending_request_id, publish_review_status, publish_review_created_at, COALESCE(patch_revision, 0), pending_request_type, pending_patch_revision, COALESCE(pending_can_cancel, 0), pending_submitter_id, pending_submitter_name
         FROM sync_state";

fn map_installed_pack(row: &rusqlite::Row<'_>) -> rusqlite::Result<InstalledPack> {
    Ok(InstalledPack {
        pack_id: row.get(0)?,
        name: row.get(1)?,
        local_path: row.get(2)?,
        version: row.get(3)?,
        patch_revision: row.get(13)?,
        last_synced: row.get(4)?,
        active: row.get::<_, i64>(5)? != 0,
        origin: row.get(6)?,
        owner_id: row.get(7)?,
        description: row.get(8)?,
        pending_version: row.get(9)?,
        pending_request_type: row.get(14)?,
        pending_patch_revision: row.get(15)?,
        pending_request_id: row.get(10)?,
        publish_review_status: row.get(11)?,
        publish_review_created_at: row.get(12)?,
        pending_can_cancel: row.get::<_, i64>(16)? != 0,
        pending_submitter_id: row.get(17)?,
        pending_submitter_name: row.get(18)?,
    })
}

pub fn list_sync_state(conn: &Connection) -> AppResult<Vec<InstalledPack>> {
    let mut stmt = conn.prepare(&format!("{INSTALLED_PACK_SELECT} ORDER BY name"))?;
    let rows = stmt.query_map([], map_installed_pack)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_sync_state(conn: &Connection, pack_id: &str) -> AppResult<Option<InstalledPack>> {
    conn.query_row(
        &format!("{INSTALLED_PACK_SELECT} WHERE pack_id = ?1"),
        params![pack_id],
        map_installed_pack,
    )
    .optional()
    .map_err(Into::into)
}

/// Records that `pack_id` has an unresolved publish request awaiting Hub
/// review. `version`/snapshot baseline are deliberately left untouched —
/// see the explicit publish commands for why.
pub struct PendingPublishUpdate<'a> {
    pub request_id: &'a str,
    pub version: &'a str,
    pub created_at: Option<&'a str>,
    pub request_type: &'a str,
    pub patch_revision: Option<i64>,
    pub can_cancel: bool,
    pub submitter_id: Option<&'a str>,
    pub submitter_name: Option<&'a str>,
}

pub fn set_pending_publish(
    conn: &Connection,
    pack_id: &str,
    pending: PendingPublishUpdate<'_>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE sync_state
         SET pending_request_id = ?1, pending_version = ?2,
             publish_review_status = 'pending',
             pending_request_type = ?4, pending_patch_revision = ?5,
             pending_can_cancel = ?7,
             pending_submitter_id = ?8, pending_submitter_name = ?9,
             publish_review_created_at = COALESCE(?3, publish_review_created_at)
         WHERE pack_id = ?6",
        params![
            pending.request_id,
            pending.version,
            pending.created_at,
            pending.request_type,
            pending.patch_revision,
            pack_id,
            if pending.can_cancel { 1 } else { 0 },
            pending.submitter_id,
            pending.submitter_name
        ],
    )?;
    Ok(())
}

pub fn set_publish_approved_awaiting_merge(
    conn: &Connection,
    pack_id: &str,
    request_id: &str,
    version: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE sync_state
         SET pending_request_id = ?1, pending_version = ?2,
             publish_review_status = 'approved_awaiting_merge',
             pending_can_cancel = 0
         WHERE pack_id = ?3",
        params![request_id, version, pack_id],
    )?;
    Ok(())
}

/// Clears a resolved (approved or rejected) publish request's marker. Does
/// not touch `version`/snapshot — callers decide separately whether the
/// resolution also advances those (see `hub_reconcile_publish_requests`).
pub fn clear_pending_publish(conn: &Connection, pack_id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE sync_state
         SET pending_request_id = NULL, pending_version = NULL,
             pending_request_type = NULL, pending_patch_revision = NULL,
             pending_can_cancel = 0,
             pending_submitter_id = NULL, pending_submitter_name = NULL,
             publish_review_status = NULL, publish_review_created_at = NULL
         WHERE pack_id = ?1",
        params![pack_id],
    )?;
    Ok(())
}

/// Resolve retrieval prefixes: @ focus under active packs, else all active roots.
pub fn resolve_retrieval_prefixes(
    conn: &Connection,
    focus_paths: &[String],
) -> AppResult<Vec<String>> {
    let active = list_active_pack_roots(conn)?;
    if focus_paths.is_empty() {
        return Ok(active);
    }
    let allowed: Vec<String> = focus_paths
        .iter()
        .filter(|f| {
            active
                .iter()
                .any(|root| *f == root || f.starts_with(&format!("{root}/")))
        })
        .cloned()
        .collect();
    if allowed.is_empty() {
        Ok(active)
    } else {
        Ok(allowed)
    }
}

/// Remove indexed chunks/FTS rows for a vault path prefix, without touching
/// `sync_state`. Used both as the first half of `purge_path_data` (removal)
/// and standalone when a pack's files *move* (rename) rather than disappear
/// — a rename needs its `sync_state` row updated in place, not deleted.
pub fn purge_chunks_for_path(conn: &Connection, path: &str) -> AppResult<()> {
    let exact = path.to_string();
    let prefix = format!("{path}/%");

    // Collect chunk ids before deleting so FTS can be purged.
    let mut stmt =
        conn.prepare("SELECT id FROM chunks WHERE file_path = ?1 OR file_path LIKE ?2")?;
    let ids: Vec<String> = stmt
        .query_map(params![exact, prefix], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    for id in &ids {
        conn.execute("DELETE FROM chunks_fts WHERE chunk_id = ?1", params![id])?;
    }

    conn.execute(
        "DELETE FROM chunks WHERE file_path = ?1 OR file_path LIKE ?2",
        params![exact, prefix],
    )?;

    recount_index_meta(conn)?;
    Ok(())
}

/// Remove chunks, FTS rows, and sync state for a vault path prefix.
pub fn purge_path_data(conn: &Connection, path: &str) -> AppResult<()> {
    purge_chunks_for_path(conn, path)?;

    let exact = path.to_string();
    let prefix = format!("{path}/%");
    conn.execute(
        "DELETE FROM sync_state WHERE pack_id = ?1 OR local_path = ?1 OR local_path LIKE ?2",
        params![exact, prefix],
    )?;

    Ok(())
}

/// Renames a pack's identity in `sync_state`. `pack_id` and `local_path`
/// always move together; the display name may retain spaces and capitalization.
pub fn rename_sync_state_pack(
    conn: &Connection,
    old_pack_id: &str,
    new_pack_id: &str,
    new_name: &str,
) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE sync_state SET pack_id = ?1, local_path = ?1, name = ?2 WHERE pack_id = ?3",
        params![new_pack_id, new_name, old_pack_id],
    )?;
    if n == 0 {
        return Err(AppError::msg(format!("Pack not installed: {old_pack_id}")));
    }
    Ok(())
}

fn recount_index_meta(conn: &Connection) -> AppResult<()> {
    let file_count: i64 =
        conn.query_row("SELECT COUNT(DISTINCT file_path) FROM chunks", [], |row| {
            row.get(0)
        })?;
    let chunk_count: i64 = conn.query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE index_meta SET indexed_files = ?1, indexed_chunks = ?2, last_indexed_at = ?3,
         message = COALESCE(message, 'Local FTS keyword index (no embeddings)') WHERE id = 1",
        params![file_count, chunk_count, now],
    )?;
    Ok(())
}

#[cfg(test)]
mod sync_state_tests {
    use super::*;

    #[test]
    fn llm_defaults_are_empty() {
        let settings = AppSettings::default();
        assert!(settings.llm_base_url.is_empty());
        assert!(settings.llm_api_key.is_empty());
        assert!(settings.chat_model.is_empty());
    }

    #[test]
    fn openrouter_keys_correct_legacy_openai_defaults() {
        let mut settings = AppSettings {
            llm_base_url: LEGACY_OPENAI_BASE_URL.into(),
            llm_api_key: "  sk-or-v1-example  ".into(),
            chat_model: LEGACY_OPENAI_CHAT_MODEL.into(),
            ..AppSettings::default()
        };
        settings.normalize_llm_configuration();
        assert_eq!(settings.llm_base_url, OPENROUTER_BASE_URL);
        assert_eq!(settings.chat_model, OPENROUTER_DEFAULT_CHAT_MODEL);
        assert_eq!(settings.llm_api_key, "sk-or-v1-example");
    }

    #[test]
    fn openrouter_keys_infer_the_endpoint_but_not_a_model() {
        let mut settings = AppSettings {
            llm_api_key: "sk-or-v1-example".into(),
            ..AppSettings::default()
        };
        settings.normalize_llm_configuration();
        assert_eq!(settings.llm_base_url, OPENROUTER_BASE_URL);
        assert!(settings.chat_model.is_empty());
    }

    #[test]
    fn openrouter_detection_preserves_explicit_custom_configuration() {
        let mut settings = AppSettings {
            llm_base_url: "https://llm.internal.example/v1/".into(),
            llm_api_key: "sk-or-v1-example".into(),
            chat_model: "custom/model".into(),
            ..AppSettings::default()
        };
        settings.normalize_llm_configuration();
        assert_eq!(settings.llm_base_url, "https://llm.internal.example/v1");
        assert_eq!(settings.chat_model, "custom/model");
    }

    #[test]
    fn migrates_legacy_pack_origins_and_updates_provenance() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE sync_state (
                pack_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                local_path TEXT NOT NULL,
                last_synced TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
             );
             INSERT INTO sync_state VALUES ('legacy', 'Legacy', '1.0.0', 'legacy', 'now', 0);",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let legacy = get_sync_state(&conn, "legacy").unwrap().unwrap();
        assert_eq!(legacy.origin, "unknown");
        assert!(!legacy.active);
        assert_eq!(legacy.description, "");

        upsert_sync_state(
            &conn,
            SyncStateUpsert {
                pack_id: "legacy",
                name: "Legacy",
                version: "2.0.0",
                local_path: "legacy",
                origin: "local",
                owner_id: None,
                description: "An updated description",
                patch_revision: 0,
            },
        )
        .unwrap();
        let updated = get_sync_state(&conn, "legacy").unwrap().unwrap();
        assert_eq!(updated.origin, "local");
        assert_eq!(updated.version, "2.0.0");
        assert_eq!(updated.description, "An updated description");
        assert!(!updated.active, "replacement must preserve active state");
        assert_eq!(updated.pending_version, None);
        assert_eq!(updated.pending_request_id, None);
    }

    fn seeded_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        upsert_sync_state(
            &conn,
            SyncStateUpsert {
                pack_id: "sample",
                name: "Sample",
                version: "1.0.0",
                local_path: "sample",
                origin: "local",
                owner_id: None,
                description: "",
                patch_revision: 0,
            },
        )
        .unwrap();
        conn
    }

    #[test]
    fn initial_chat_session_is_created_only_once() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        let first = get_or_create_initial_session(&conn).unwrap();
        let second = get_or_create_initial_session(&conn).unwrap();

        assert_eq!(first.id, second.id);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chat_sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn chat_mode_and_file_changes_round_trip() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let session = create_session(&conn, "Agent work").unwrap();
        let updated = update_session(
            &conn,
            &session.id,
            ChatSessionUpdate {
                mode: Some("agent".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.mode, "agent");

        let message = add_message(
            &mut conn,
            &session.id,
            NewChatMessage {
                role: "assistant",
                content: "Updated the guide.",
                citations: None,
                thinking: None,
                thinking_seconds: None,
                file_changes: &[NewChatFileChange {
                    path: "sample/guide.md".into(),
                    operation: "modified".into(),
                    old_content: Some("before".into()),
                    new_content: Some("after".into()),
                    status: "pending".into(),
                    rebase_count: 0,
                    resolution_reason: None,
                }],
            },
        )
        .unwrap();
        assert_eq!(message.file_changes.len(), 1);
        let detail = get_chat_file_change(&conn, &message.file_changes[0].id).unwrap();
        assert_eq!(detail.path, "sample/guide.md");
        assert_eq!(detail.status, "pending");
        assert_eq!(detail.old_content.as_deref(), Some("before"));
        assert_eq!(detail.new_content.as_deref(), Some("after"));
        assert!(
            get_pending_chat_file_change_for_path(&conn, "sample/guide.md")
                .unwrap()
                .is_some()
        );
        set_chat_file_change_status(&conn, &detail.id, "approved").unwrap();
        assert!(
            get_pending_chat_file_change_for_path(&conn, "sample/guide.md")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn no_op_follow_up_clears_the_prior_pending_proposal() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let session = create_session(&conn, "Agent work").unwrap();
        let proposed = [NewChatFileChange {
            path: "sample/new.md".into(),
            operation: "created".into(),
            old_content: None,
            new_content: Some("draft".into()),
            status: "pending".into(),
            rebase_count: 0,
            resolution_reason: None,
        }];
        let reverted = [NewChatFileChange {
            path: "sample/new.md".into(),
            operation: "modified".into(),
            old_content: None,
            new_content: None,
            status: "pending".into(),
            rebase_count: 0,
            resolution_reason: None,
        }];
        for changes in [&proposed[..], &reverted[..]] {
            add_message(
                &mut conn,
                &session.id,
                NewChatMessage {
                    role: "assistant",
                    content: "Done.",
                    citations: None,
                    thinking: None,
                    thinking_seconds: None,
                    file_changes: changes,
                },
            )
            .unwrap();
        }
        assert!(
            get_pending_chat_file_change_for_path(&conn, "sample/new.md")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn conflicted_turn_proposal_persists_conflict_and_rebase_metadata() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let session = create_session(&conn, "Agent work").unwrap();
        let message = add_message(
            &mut conn,
            &session.id,
            NewChatMessage {
                role: "assistant",
                content: "Conflict detected.",
                citations: None,
                thinking: None,
                thinking_seconds: None,
                file_changes: &[NewChatFileChange {
                    path: "sample/conflict.md".into(),
                    operation: "modified".into(),
                    old_content: Some("direct".into()),
                    new_content: Some("proposed".into()),
                    status: "conflicted".into(),
                    rebase_count: 1,
                    resolution_reason: Some("overlap".into()),
                }],
            },
        )
        .unwrap();

        assert_eq!(message.file_changes[0].status, "conflicted");
        let detail = get_chat_file_change(&conn, &message.file_changes[0].id).unwrap();
        assert_eq!(detail.status, "conflicted");
        assert_eq!(detail.rebase_count, 1);
        assert_eq!(detail.resolution_reason.as_deref(), Some("overlap"));
        let reviewable =
            get_pending_chat_file_change_for_path(&conn, "sample/conflict.md").unwrap();
        assert_eq!(reviewable.unwrap().status, "conflicted");
    }

    #[test]
    fn pending_publish_round_trips_through_get_and_list_sync_state() {
        let conn = seeded_conn();

        set_pending_publish(
            &conn,
            "sample",
            PendingPublishUpdate {
                request_id: "req-1",
                version: "1.1.0",
                created_at: Some("now"),
                request_type: "release",
                patch_revision: None,
                can_cancel: true,
                submitter_id: Some("alice"),
                submitter_name: Some("Alice"),
            },
        )
        .unwrap();
        let pending = get_sync_state(&conn, "sample").unwrap().unwrap();
        assert_eq!(pending.pending_request_id.as_deref(), Some("req-1"));
        assert_eq!(pending.pending_version.as_deref(), Some("1.1.0"));
        assert_eq!(pending.pending_request_type.as_deref(), Some("release"));
        assert_eq!(pending.pending_patch_revision, None);
        assert_eq!(pending.pending_submitter_id.as_deref(), Some("alice"));
        assert_eq!(pending.pending_submitter_name.as_deref(), Some("Alice"));
        assert_eq!(pending.publish_review_status.as_deref(), Some("pending"));
        assert_eq!(pending.publish_review_created_at.as_deref(), Some("now"));
        assert!(pending.pending_can_cancel);
        // `version` (the last-approved value) must stay untouched by a pending marker.
        assert_eq!(pending.version, "1.0.0");
        let listed = list_sync_state(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].pending_request_id.as_deref(), Some("req-1"));

        set_publish_approved_awaiting_merge(&conn, "sample", "req-1", "1.1.0").unwrap();
        let approved = get_sync_state(&conn, "sample").unwrap().unwrap();
        assert_eq!(
            approved.publish_review_status.as_deref(),
            Some("approved_awaiting_merge")
        );
        assert_eq!(approved.version, "1.0.0");
        assert!(!approved.pending_can_cancel);

        clear_pending_publish(&conn, "sample").unwrap();
        let cleared = get_sync_state(&conn, "sample").unwrap().unwrap();
        assert_eq!(cleared.pending_request_id, None);
        assert_eq!(cleared.pending_version, None);
        assert_eq!(cleared.publish_review_status, None);
        assert_eq!(cleared.publish_review_created_at, None);
        assert!(!cleared.pending_can_cancel);
        assert_eq!(cleared.version, "1.0.0", "clearing must not touch version");
    }
}

#[cfg(test)]
mod chat_backend_tests {
    use super::*;

    fn migrated_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn legacy_db_with_session() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE chat_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                title_source TEXT NOT NULL DEFAULT 'placeholder',
                mode TEXT NOT NULL DEFAULT 'ask',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO chat_sessions
                (id, title, title_source, mode, created_at, updated_at)
            VALUES
                ('legacy', 'Old chat', 'llm', 'ask', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z');",
        )
        .unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn migrates_existing_sessions_to_nest_ready() {
        let conn = legacy_db_with_session();
        let session = get_session(&conn, "legacy").unwrap().unwrap();
        assert_eq!(session.backend, Some(BackendId::nest()));
        assert_eq!(session.backend_status, ChatBackendStatus::Ready);
        assert_eq!(
            session.selected_backend_id.as_deref(),
            Some("nest"),
            "bound legacy sessions inherit their backend as selection"
        );
        assert_eq!(session.selected_model.kind, ModelSelectionKind::Default);
        assert_eq!(session.selection_revision, 0);
    }

    #[test]
    fn new_sessions_start_with_nest_selection_and_zero_revision() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        assert_eq!(session.backend, None);
        assert_eq!(session.selected_backend_id.as_deref(), Some("nest"));
        assert_eq!(session.selected_model.kind, ModelSelectionKind::Default);
        assert_eq!(session.selection_revision, 0);
    }

    #[test]
    fn model_selection_parse_validates_kind_and_value() {
        assert_eq!(
            ModelSelection::parse("default", None).unwrap().kind,
            ModelSelectionKind::Default
        );
        assert!(ModelSelection::parse("explicit", Some("glm-5.3")).is_ok());
        assert!(ModelSelection::parse("explicit", None).is_err());
        assert!(ModelSelection::parse("explicit", Some("  ")).is_err());
        assert!(ModelSelection::parse("bogus", None).is_err());
    }

    #[test]
    fn cli_model_arg_maps_selection_to_transport() {
        let default = ModelSelection::default();
        assert_eq!(default.cli_model_arg(), Some("default"));
        let explicit = ModelSelection::parse("explicit", Some("glm-5.3")).unwrap();
        assert_eq!(explicit.cli_model_arg(), Some("glm-5.3"));
    }

    #[test]
    fn selection_update_requires_matching_revision() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        let updated = update_session_selection(
            &conn,
            &session.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::claude()),
                selected_model: Some(ModelSelection::parse("explicit", Some("glm-5.3")).unwrap()),
                mode: Some("agent".to_string()),
            },
        )
        .unwrap();
        assert_eq!(updated.selection_revision, 1);
        assert_eq!(updated.selected_backend_id.as_deref(), Some("claude"));
        assert_eq!(updated.selected_model.value.as_deref(), Some("glm-5.3"));
        assert_eq!(updated.mode, "agent");

        let stale = update_session_selection(&conn, &session.id, 0, SelectionPatch::default());
        assert!(stale.is_err());
        let message = stale.unwrap_err().to_string();
        assert!(message.contains("chat_selection_stale"));
    }

    #[test]
    fn bound_sessions_reject_backend_selection_change() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        let mut conn = conn;
        begin_chat_turn(&mut conn, &session.id, 0, "hi").unwrap();
        let result = update_session_selection(
            &conn,
            &session.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::nest()),
                ..Default::default()
            },
        );
        assert!(result.is_err());
        let message = result.unwrap_err().to_string();
        assert!(message.contains("chat_backend_bound"));
    }

    #[test]
    fn bound_sessions_can_still_change_model_and_mode() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        update_session_selection(
            &conn,
            &session.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::claude()),
                ..Default::default()
            },
        )
        .unwrap();
        let mut conn = conn;
        begin_chat_turn(&mut conn, &session.id, 1, "hi").unwrap();
        let updated = update_session_selection(
            &conn,
            &session.id,
            1,
            SelectionPatch {
                selected_model: Some(ModelSelection::parse("explicit", Some("glm-4.7")).unwrap()),
                mode: Some("agent".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.selected_model.value.as_deref(), Some("glm-4.7"));
        assert_eq!(updated.mode, "agent");
        assert_eq!(updated.backend, Some(BackendId::claude()));
    }

    #[test]
    fn new_session_defaults_inherit_most_recent_session() {
        let conn = migrated_db();
        conn.execute(
            "INSERT INTO settings(key, value) VALUES ('chat_model', 'gpt-test')",
            [],
        )
        .unwrap();
        let first = create_session(&conn, "a").unwrap();
        update_session_selection(
            &conn,
            &first.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::claude()),
                selected_model: Some(ModelSelection::parse("explicit", Some("glm-5.3")).unwrap()),
                mode: None,
            },
        )
        .unwrap();

        let (backend, model) = default_selection_for_new_session(&conn, "gpt-test");
        assert_eq!(backend, BackendId::claude());
        assert_eq!(model.value.as_deref(), Some("glm-5.3"));

        let (backend, model) = default_selection_for_new_session(&conn, "");
        assert_eq!(backend, BackendId::claude());
        assert_eq!(
            model.value.as_deref(),
            Some("glm-5.3"),
            "recent session selection inherits verbatim regardless of current chat_model"
        );
    }

    #[test]
    fn no_history_defaults_to_nest_with_configured_model() {
        let conn = migrated_db();
        let (backend, model) = default_selection_for_new_session(&conn, "gpt-test");
        assert_eq!(backend, BackendId::nest());
        assert_eq!(model.value.as_deref(), Some("gpt-test"));
        let (backend, model) = default_selection_for_new_session(&conn, "");
        assert_eq!(backend, BackendId::nest());
        assert_eq!(model.kind, ModelSelectionKind::Default);
    }

    #[test]
    fn local_title_collapses_whitespace_and_truncates() {
        assert_eq!(local_session_title("hello"), "hello");
        assert_eq!(local_session_title("  a \n b\t c  "), "a b c");
        assert_eq!(local_session_title(""), "New chat");
        assert_eq!(local_session_title("   \n\t "), "New chat");
        let long = "x".repeat(60);
        let title = local_session_title(&long);
        assert_eq!(title.chars().count(), 49);
        assert!(title.ends_with('…'));
        let exactly = "y".repeat(48);
        assert_eq!(local_session_title(&exactly), exactly);
    }

    #[test]
    fn migration_backfill_runs_once_and_never_touches_new_unbound_sessions() {
        let conn = legacy_db_with_session();
        migrate(&conn).unwrap();
        let legacy = get_session(&conn, "legacy").unwrap().unwrap();
        assert_eq!(legacy.backend, Some(BackendId::nest()));
        assert_eq!(legacy.backend_status, ChatBackendStatus::Ready);
        let fresh = create_session(&conn, "New chat").unwrap();
        migrate(&conn).unwrap();
        let fresh = get_session(&conn, &fresh.id).unwrap().unwrap();
        assert_eq!(fresh.backend, None);
        assert_eq!(fresh.backend_status, ChatBackendStatus::Uninitialized);
    }

    #[test]
    fn new_sessions_start_unbound_and_uninitialized() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        assert_eq!(session.backend, None);
        assert_eq!(session.backend_status, ChatBackendStatus::Uninitialized);
    }

    #[test]
    fn first_bind_nest_marks_ready_and_persists_user_message() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        let mut conn = conn;
        let prepared = begin_chat_turn(&mut conn, &session.id, 0, "hi").unwrap();
        assert_eq!(prepared.session.backend, Some(BackendId::nest()));
        assert_eq!(prepared.session.backend_status, ChatBackendStatus::Ready);
        assert_eq!(prepared.user_message.role, "user");
        assert_eq!(prepared.user_message.content, "hi");

        let reloaded = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(reloaded.backend, Some(BackendId::nest()));
        assert_eq!(reloaded.backend_status, ChatBackendStatus::Ready);
        let messages = list_messages(&conn, &session.id).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "hi");
        assert_eq!(messages[0].role, "user");
    }

    #[test]
    fn first_bind_claude_stays_uninitialized() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        update_session_selection(
            &conn,
            &session.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::claude()),
                ..Default::default()
            },
        )
        .unwrap();
        let mut conn = conn;
        let prepared = begin_chat_turn(&mut conn, &session.id, 1, "hi").unwrap();
        assert_eq!(prepared.session.backend, Some(BackendId::claude()));
        assert_eq!(
            prepared.session.backend_status,
            ChatBackendStatus::Uninitialized
        );
    }

    #[test]
    fn claude_init_marks_session_ready() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        update_session_selection(
            &conn,
            &session.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::claude()),
                ..Default::default()
            },
        )
        .unwrap();
        let mut conn = conn;
        begin_chat_turn(&mut conn, &session.id, 1, "hi").unwrap();
        let updated =
            set_session_backend_status(&conn, &session.id, ChatBackendStatus::Ready).unwrap();
        assert_eq!(updated.backend, Some(BackendId::claude()));
        assert_eq!(updated.backend_status, ChatBackendStatus::Ready);
        assert_eq!(
            get_session(&conn, &session.id)
                .unwrap()
                .unwrap()
                .backend_status,
            ChatBackendStatus::Ready
        );
    }

    #[test]
    fn second_bind_keeps_existing_backend_and_still_inserts_message() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        update_session_selection(
            &conn,
            &session.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::claude()),
                ..Default::default()
            },
        )
        .unwrap();
        let mut conn = conn;
        begin_chat_turn(&mut conn, &session.id, 1, "one").unwrap();
        let prepared = begin_chat_turn(&mut conn, &session.id, 1, "two").unwrap();
        assert_eq!(
            prepared.session.backend,
            Some(BackendId::claude()),
            "bound backend wins over any later selection"
        );
        let messages = list_messages(&conn, &session.id).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].content, "two");
    }

    #[test]
    fn begin_chat_turn_rejects_stale_revision() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        let mut conn = conn;
        let result = begin_chat_turn(&mut conn, &session.id, 7, "hi");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("chat_selection_stale"));
    }

    #[test]
    fn first_claude_turn_writes_local_title() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        update_session_selection(
            &conn,
            &session.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::claude()),
                ..Default::default()
            },
        )
        .unwrap();
        let mut conn = conn;
        let prepared =
            begin_chat_turn(&mut conn, &session.id, 1, "how do I export a pack?").unwrap();
        assert_eq!(prepared.session.title, "how do I export a pack?");
        assert_eq!(prepared.session.title_source, TITLE_SOURCE_LOCAL);
    }

    #[test]
    fn first_nest_turn_keeps_placeholder_title() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        let mut conn = conn;
        let prepared = begin_chat_turn(&mut conn, &session.id, 0, "hello world").unwrap();
        assert_eq!(prepared.session.title, "New chat");
        assert_eq!(prepared.session.title_source, TITLE_SOURCE_PLACEHOLDER);
    }

    #[test]
    fn chat_turn_row_is_created_running_then_finished() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        let mut conn = conn;
        let prepared = begin_chat_turn(&mut conn, &session.id, 0, "hi").unwrap();
        let status: (String, String) = conn
            .query_row(
                "SELECT status, backend_id FROM chat_turns WHERE id = ?1",
                params![prepared.turn_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status.0, "running");
        assert_eq!(status.1, "nest");

        let assistant = add_message(
            &mut conn,
            &session.id,
            NewChatMessage {
                role: "assistant",
                content: "answer",
                citations: None,
                thinking: None,
                thinking_seconds: None,
                file_changes: &[],
            },
        )
        .unwrap();
        finish_chat_turn(
            &conn,
            &prepared.turn_id,
            "succeeded",
            Some("gpt-test"),
            Some(&assistant.id),
            None,
            None,
        )
        .unwrap();
        let finished: (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT status, effective_model, assistant_message_id FROM chat_turns WHERE id = ?1",
                params![prepared.turn_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(finished.0, "succeeded");
        assert_eq!(finished.1.as_deref(), Some("gpt-test"));
        assert_eq!(finished.2.as_deref(), Some(assistant.id.as_str()));
    }

    #[test]
    fn bind_unknown_session_fails_without_side_effects() {
        let conn = migrated_db();
        let mut conn = conn;
        let result = begin_chat_turn(&mut conn, "00000000-0000-4000-8000-000000000000", 0, "hi");
        assert!(result.is_err());
    }

    #[test]
    fn unresumable_status_persists() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        update_session_selection(
            &conn,
            &session.id,
            0,
            SelectionPatch {
                selected_backend_id: Some(BackendId::claude()),
                ..Default::default()
            },
        )
        .unwrap();
        let mut conn = conn;
        begin_chat_turn(&mut conn, &session.id, 1, "hi").unwrap();
        set_session_backend_status(&conn, &session.id, ChatBackendStatus::Unresumable).unwrap();
        let reloaded = get_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(reloaded.backend, Some(BackendId::claude()));
        assert_eq!(reloaded.backend_status, ChatBackendStatus::Unresumable);
    }

    #[test]
    fn unknown_backend_values_round_trip_without_falling_back() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        conn.execute(
            "UPDATE chat_sessions SET backend = 'grok' WHERE id = ?1",
            params![session.id],
        )
        .unwrap();
        assert_eq!(
            get_session(&conn, &session.id)
                .unwrap()
                .unwrap()
                .backend
                .unwrap()
                .as_str(),
            "grok"
        );
    }

    #[test]
    fn list_sessions_preserves_unknown_backend_value() {
        let conn = migrated_db();
        create_session(&conn, "a").unwrap();
        create_session(&conn, "b").unwrap();
        conn.execute(
            "UPDATE chat_sessions SET backend = 'grok' WHERE id = (SELECT id FROM chat_sessions ORDER BY created_at LIMIT 1)",
            [],
        )
        .unwrap();
        assert!(list_sessions(&conn).unwrap().iter().any(|session| session
            .backend
            .as_ref()
            .is_some_and(|id| id.as_str() == "grok")));
    }

    #[test]
    fn first_message_bumps_session_updated_at() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        let before = session.updated_at.clone();
        let mut conn = conn;
        begin_chat_turn(&mut conn, &session.id, 0, "hi").unwrap();
        let after = get_session(&conn, &session.id).unwrap().unwrap();
        assert_ne!(after.updated_at, before);
    }

    #[test]
    fn unknown_backend_status_values_fail() {
        let conn = migrated_db();
        let session = create_session(&conn, "New chat").unwrap();
        conn.execute(
            "UPDATE chat_sessions SET backend_status = 'loading' WHERE id = ?1",
            params![session.id],
        )
        .unwrap();
        assert!(get_session(&conn, &session.id).is_err());
    }

    #[test]
    fn general_settings_save_never_writes_claude_keys() {
        let conn = migrated_db();
        save_claude_settings(
            &conn,
            true,
            "C:\\claude\\claude.exe",
            "--skip-safe-check",
            "glm-5.3",
        )
        .unwrap();
        let mut general = GeneralSettingsUpdate::from(&get_settings(&conn).unwrap());
        general.chat_model = "gpt-test".into();
        save_general_settings(&conn, &general).unwrap();

        let reloaded = get_settings(&conn).unwrap();
        assert_eq!(reloaded.chat_model, "gpt-test");
        assert!(reloaded.claude_agent_enabled);
        assert_eq!(reloaded.claude_cli_path, "C:\\claude\\claude.exe");
        assert_eq!(reloaded.claude_custom_args, "--skip-safe-check");
        assert_eq!(reloaded.claude_custom_models, "glm-5.3");
    }

    #[test]
    fn general_settings_update_deserializes_full_app_settings_payload() {
        let payload = serde_json::json!({
            "llm_base_url": "https://api.openai.com/v1",
            "llm_api_key": "sk-x",
            "chat_model": "gpt-4o-mini",
            "hub_base_url": "",
            "proxy_url": "",
            "proxy_enabled": false,
            "font_size_pt": 12,
            "display_language": "en",
            "knowledge_dir": "",
            "resolved_knowledge_dir": "",
            "claude_agent_enabled": true,
            "claude_cli_path": "D:\\evil\\override.exe",
            "claude_custom_models": "hijacked"
        });
        let update: GeneralSettingsUpdate = serde_json::from_value(payload).unwrap();
        assert_eq!(update.chat_model, "gpt-4o-mini");
        assert_eq!(update.llm_base_url, "https://api.openai.com/v1");
        assert!(update.knowledge_dir.is_empty());
    }

    #[test]
    fn interleaved_claude_and_general_saves_keep_claude_config() {
        let conn = migrated_db();
        save_claude_settings(&conn, true, "C:\\claude\\claude.exe", "", "glm-5.3").unwrap();
        let general = GeneralSettingsUpdate::from(&get_settings(&conn).unwrap());
        save_general_settings(&conn, &general).unwrap();
        save_claude_settings(&conn, true, "C:\\claude\\new.exe", "", "glm-5.3").unwrap();
        let reloaded = get_settings(&conn).unwrap();
        assert_eq!(reloaded.claude_cli_path, "C:\\claude\\new.exe");
        assert!(reloaded.claude_agent_enabled);
    }

    #[test]
    fn claude_custom_models_normalize_trims_dedupes_and_preserves_order() {
        assert_eq!(normalize_claude_custom_models(""), "");
        assert_eq!(normalize_claude_custom_models("\n\n"), "");
        assert_eq!(
            normalize_claude_custom_models("  glm-5.3  \n\nclaude-sonnet-4-5\nglm-5.3\n"),
            "glm-5.3\nclaude-sonnet-4-5"
        );
        assert_eq!(normalize_claude_custom_models("a\r\nb\r\n"), "a\nb");
    }

    #[test]
    fn claude_settings_defaults_are_disabled_and_empty() {
        let settings = AppSettings::default();
        assert!(!settings.claude_agent_enabled);
        assert!(settings.claude_cli_path.is_empty());
        assert!(settings.claude_custom_args.is_empty());
        assert!(settings.claude_custom_models.is_empty());
    }

    #[test]
    fn claude_connection_report_round_trips() {
        let conn = migrated_db();
        assert!(load_claude_connection_report(&conn).is_none());
        let report = ClaudeConnectionReport {
            status: ClaudeConnectionStatus::Connected,
            configured_cli_path: "C:\\claude\\claude.exe".into(),
            configured_cli_args: String::new(),
            resolved_cli_path: "C:\\claude\\wrapper.cjs".into(),
            cli_version: "2.1.238".into(),
            effective_model: "glm-5.3[1m]".into(),
            tested_at: "2026-01-01T00:00:00Z".into(),
            message: None,
        };
        save_claude_connection_report(&conn, &report).unwrap();
        assert_eq!(load_claude_connection_report(&conn), Some(report));
    }

    #[test]
    fn model_options_show_default_then_custom_deduped() {
        let options = claude_model_options("glm-5.3[1m]\nclaude-sonnet-4-5\nclaude-sonnet-4-5\n  ");
        assert_eq!(options.len(), 3);
        assert_eq!(options[0].source, ClaudeModelSource::Default);
        assert_eq!(options[1].model_id, "glm-5.3[1m]");
        assert_eq!(options[1].source, ClaudeModelSource::Custom);
        assert_eq!(options[2].model_id, "claude-sonnet-4-5");
        assert_eq!(options[2].source, ClaudeModelSource::Custom);
    }

    #[test]
    fn model_status_roundtrip_and_prune_on_save() {
        let conn = migrated_db();
        upsert_claude_model_status(
            &conn,
            "glm-5.3",
            &ClaudeModelStatusEntry {
                configured_cli_path: Some("C:\\claude\\claude.exe".into()),
                configured_cli_args: Some(String::new()),
                ok: true,
                message: None,
                tested_at: "t1".into(),
            },
        )
        .unwrap();
        upsert_claude_model_status(
            &conn,
            "broken",
            &ClaudeModelStatusEntry {
                configured_cli_path: Some("C:\\claude\\claude.exe".into()),
                configured_cli_args: Some(String::new()),
                ok: false,
                message: Some("no such model".into()),
                tested_at: "t2".into(),
            },
        )
        .unwrap();
        let statuses = load_claude_model_statuses(&conn).unwrap();
        assert_eq!(statuses.len(), 2);
        assert!(
            !model_status_for_configured_path(&statuses, "C:\\claude\\claude.exe", "", "broken")
                .unwrap()
                .ok
        );

        save_claude_settings(&conn, true, "C:\\claude\\claude.exe", "", "glm-5.3").unwrap();
        let statuses = load_claude_model_statuses(&conn).unwrap();
        assert_eq!(statuses.len(), 1);
        assert!(model_status_for_configured_path(
            &statuses,
            "C:\\claude\\claude.exe",
            "",
            "glm-5.3"
        )
        .is_some());
    }

    #[test]
    fn model_statuses_preserve_results_for_each_cli_path() {
        let conn = migrated_db();
        upsert_claude_model_status(
            &conn,
            "kimi",
            &ClaudeModelStatusEntry {
                configured_cli_path: Some("C:\\claude\\saved.exe".into()),
                configured_cli_args: Some(String::new()),
                ok: false,
                message: Some("unavailable".into()),
                tested_at: "t1".into(),
            },
        )
        .unwrap();
        upsert_claude_model_status(
            &conn,
            "kimi",
            &ClaudeModelStatusEntry {
                configured_cli_path: Some("C:\\claude\\draft.exe".into()),
                configured_cli_args: Some(String::new()),
                ok: true,
                message: None,
                tested_at: "t2".into(),
            },
        )
        .unwrap();

        let statuses = load_claude_model_statuses(&conn).unwrap();
        assert!(
            !model_status_for_configured_path(&statuses, "C:\\claude\\saved.exe", "", "kimi")
                .unwrap()
                .ok
        );
        assert!(
            model_status_for_configured_path(&statuses, "C:\\claude\\draft.exe", "", "kimi")
                .unwrap()
                .ok
        );
    }

    #[test]
    fn model_status_supports_the_empty_auto_detect_path() {
        let conn = migrated_db();
        upsert_claude_model_status(
            &conn,
            "kimi",
            &ClaudeModelStatusEntry {
                configured_cli_path: Some(String::new()),
                configured_cli_args: Some(String::new()),
                ok: true,
                message: None,
                tested_at: "t1".into(),
            },
        )
        .unwrap();

        let statuses = load_claude_model_statuses(&conn).unwrap();
        assert!(
            model_status_for_configured_path(&statuses, "", "", "kimi")
                .unwrap()
                .ok
        );
    }

    #[test]
    fn legacy_model_status_without_a_cli_path_is_ignored() {
        let conn = migrated_db();
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)",
            rusqlite::params![
                CLAUDE_MODEL_STATUS_KEY,
                r#"{"kimi":{"ok":false,"message":"old","tested_at":"t0"}}"#
            ],
        )
        .unwrap();

        let statuses = load_claude_model_statuses(&conn).unwrap();
        assert!(model_status_for_configured_path(&statuses, "", "", "kimi").is_none());
        assert!(model_status_for_configured_path(&statuses, "/saved/claude", "", "kimi").is_none());
    }

    #[test]
    fn connection_proof_requires_enabled_and_matching_path() {
        let connected = ClaudeConnectionReport {
            status: ClaudeConnectionStatus::Connected,
            configured_cli_path: "C:\\claude\\claude.exe".into(),
            ..Default::default()
        };
        assert!(connection_proven_from(
            true,
            "C:\\claude\\claude.exe",
            "",
            Some(&connected),
            None
        ));
        assert!(!connection_proven_from(
            false,
            "C:\\claude\\claude.exe",
            "",
            Some(&connected),
            None
        ));
        assert!(!connection_proven_from(
            true,
            "D:\\other\\claude.exe",
            "",
            Some(&connected),
            None
        ));
        assert!(!connection_proven_from(
            true,
            "C:\\claude\\claude.exe",
            "--skip-safe-check",
            Some(&connected),
            None
        ));
        assert!(connection_proven_from(
            true,
            "C:\\claude\\claude.exe",
            "",
            None,
            Some(&connected)
        ));
        let unavailable = ClaudeConnectionReport {
            status: ClaudeConnectionStatus::Unavailable,
            configured_cli_path: "C:\\claude\\claude.exe".into(),
            ..Default::default()
        };
        assert!(!connection_proven_from(
            true,
            "C:\\claude\\claude.exe",
            "",
            Some(&unavailable),
            Some(&connected)
        ));
        let last_connected = ClaudeConnectionReport {
            status: ClaudeConnectionStatus::LastConnected,
            configured_cli_path: "C:\\claude\\claude.exe".into(),
            ..Default::default()
        };
        assert!(!connection_proven_from(
            true,
            "C:\\claude\\claude.exe",
            "",
            Some(&last_connected),
            None
        ));
    }

    #[test]
    fn legacy_settings_json_without_claude_fields_deserializes() {
        let legacy = r#"{
            "llm_base_url": "https://api.openai.com/v1",
            "llm_api_key": "sk-x",
            "chat_model": "gpt-4o-mini",
            "hub_base_url": "",
            "proxy_url": "",
            "proxy_enabled": false,
            "font_size_pt": 12,
            "display_language": "en",
            "knowledge_dir": "",
            "resolved_knowledge_dir": ""
        }"#;
        let settings: AppSettings = serde_json::from_str(legacy).unwrap();
        assert!(!settings.claude_agent_enabled);
        assert!(settings.claude_cli_path.is_empty());
        assert!(settings.claude_custom_models.is_empty());
    }

    #[test]
    fn legacy_session_json_without_backend_fields_deserializes_unbound() {
        let legacy = r#"{
            "id": "s1",
            "title": "Old",
            "pinned": false,
            "archived": false,
            "title_source": "placeholder",
            "mode": "ask",
            "created_at": "2020-01-01T00:00:00Z",
            "updated_at": "2020-01-01T00:00:00Z"
        }"#;
        let session: ChatSession = serde_json::from_str(legacy).unwrap();
        assert_eq!(session.backend, None);
        assert_eq!(session.backend_status, ChatBackendStatus::Uninitialized);
    }
}
