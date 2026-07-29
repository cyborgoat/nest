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
        }
    }
}

fn default_font_size_pt() -> u32 {
    10
}

fn default_display_language() -> String {
    "en".into()
}

impl AppSettings {
    /// Normalize user-entered LLM settings and correct the common case where
    /// an OpenRouter key is pasted while Nest's untouched OpenAI defaults are
    /// still selected. Explicit custom endpoints and models are preserved.
    pub fn normalize_llm_configuration(&mut self) {
        self.llm_base_url = self.llm_base_url.trim().trim_end_matches('/').to_string();
        self.llm_api_key = self.llm_api_key.trim().to_string();
        self.chat_model = self.chat_model.trim().to_string();

        let openrouter_key = self.llm_api_key.starts_with("sk-or-v1-");
        let default_openai_endpoint =
            self.llm_base_url.is_empty() || self.llm_base_url == LEGACY_OPENAI_BASE_URL;
        if openrouter_key && default_openai_endpoint {
            self.llm_base_url = OPENROUTER_BASE_URL.into();
        }
        if (openrouter_key || self.llm_base_url == OPENROUTER_BASE_URL)
            && self.chat_model == LEGACY_OPENAI_CHAT_MODEL
        {
            self.chat_model = OPENROUTER_DEFAULT_CHAT_MODEL.into();
        }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    pub archived: bool,
    /// `placeholder` | `llm` | `manual`
    pub title_source: String,
    pub created_at: String,
    pub updated_at: String,
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
    pub created_at: String,
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
    pub pending_request_id: Option<String>,
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

        CREATE TABLE IF NOT EXISTS sync_state (
            pack_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            local_path TEXT NOT NULL,
            last_synced TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            origin TEXT NOT NULL DEFAULT 'unknown'
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
    ensure_message_thinking_columns(conn)?;
    ensure_sync_state_active_column(conn)?;
    ensure_sync_state_origin_column(conn)?;
    ensure_sync_state_owner_id_column(conn)?;
    ensure_sync_state_description_column(conn)?;
    ensure_sync_state_pending_columns(conn)?;
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
    Ok(())
}

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatSession> {
    Ok(ChatSession {
        id: row.get(0)?,
        title: row.get(1)?,
        pinned: row.get::<_, i64>(2)? != 0,
        archived: row.get::<_, i64>(3)? != 0,
        title_source: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
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

pub fn save_settings(conn: &Connection, settings: &AppSettings) -> AppResult<()> {
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
    for (key, value) in pairs {
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
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
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO chat_sessions (id, title, pinned, archived, title_source, created_at, updated_at)
         VALUES (?1, ?2, 0, 0, ?3, ?4, ?5)",
        params![id, title, TITLE_SOURCE_PLACEHOLDER, now, now],
    )?;
    Ok(ChatSession {
        id,
        title: title.to_string(),
        pinned: false,
        archived: false,
        title_source: TITLE_SOURCE_PLACEHOLDER.to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn get_or_create_initial_session(conn: &Connection) -> AppResult<ChatSession> {
    let mut stmt = conn.prepare(
        "SELECT id, title, pinned, archived, title_source, created_at, updated_at
         FROM chat_sessions
         WHERE archived = 0
         ORDER BY pinned DESC, updated_at DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        return Ok(map_session_row(row)?);
    }
    drop(rows);
    drop(stmt);
    create_session(conn, "New chat")
}

pub fn get_session(conn: &Connection, session_id: &str) -> AppResult<Option<ChatSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, pinned, archived, title_source, created_at, updated_at
         FROM chat_sessions WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![session_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(map_session_row(row)?))
    } else {
        Ok(None)
    }
}

pub fn list_sessions(conn: &Connection) -> AppResult<Vec<ChatSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, pinned, archived, title_source, created_at, updated_at
         FROM chat_sessions
         ORDER BY pinned DESC, updated_at DESC",
    )?;
    let rows = stmt.query_map([], map_session_row)?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[derive(Debug, Clone, Default)]
pub struct ChatSessionUpdate {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub title_source: Option<String>,
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

    let now = Utc::now().to_rfc3339();
    current.updated_at = now.clone();

    conn.execute(
        "UPDATE chat_sessions
         SET title = ?1, pinned = ?2, archived = ?3, title_source = ?4, updated_at = ?5
         WHERE id = ?6",
        params![
            current.title,
            if current.pinned { 1 } else { 0 },
            if current.archived { 1 } else { 0 },
            current.title_source,
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

pub fn add_message(
    conn: &Connection,
    session_id: &str,
    role: &str,
    content: &str,
    citations: Option<&[Citation]>,
    thinking: Option<&str>,
    thinking_seconds: Option<f64>,
) -> AppResult<ChatMessage> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let citations_json = citations
        .map(serde_json::to_string)
        .transpose()?
        .unwrap_or_default();
    conn.execute(
        "INSERT INTO chat_messages (id, session_id, role, content, citations_json, thinking, thinking_seconds, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, session_id, role, content, citations_json, thinking, thinking_seconds, now],
    )?;
    conn.execute(
        "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )?;
    Ok(ChatMessage {
        id,
        role: role.to_string(),
        content: content.to_string(),
        citations: citations.map(|c| c.to_vec()),
        thinking: thinking.map(str::to_string),
        thinking_seconds,
        created_at: now,
    })
}

pub fn list_messages(conn: &Connection, session_id: &str) -> AppResult<Vec<ChatMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, content, citations_json, thinking, thinking_seconds, created_at FROM chat_messages
         WHERE session_id = ?1 ORDER BY created_at ASC",
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
            created_at: row.get(6)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
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
}

pub fn upsert_sync_state(conn: &Connection, values: SyncStateUpsert<'_>) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    // Preserve active flag on upgrade; new packs default to active=1.
    // owner_id is only overwritten when the caller actually knows it — a
    // re-sync/import that doesn't have owner info shouldn't clobber a
    // previously-recorded owner with NULL.
    conn.execute(
        "INSERT INTO sync_state (pack_id, name, version, local_path, last_synced, active, origin, owner_id, description)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8)
         ON CONFLICT(pack_id) DO UPDATE SET
           name = excluded.name,
           version = excluded.version,
           local_path = excluded.local_path,
           last_synced = excluded.last_synced,
           origin = excluded.origin,
           owner_id = COALESCE(excluded.owner_id, sync_state.owner_id),
           description = excluded.description",
        params![
            values.pack_id,
            values.name,
            values.version,
            values.local_path,
            now,
            values.origin,
            values.owner_id,
            values.description
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

pub fn list_sync_state(conn: &Connection) -> AppResult<Vec<InstalledPack>> {
    let mut stmt = conn.prepare(
        "SELECT pack_id, name, local_path, version, last_synced, COALESCE(active, 1), COALESCE(origin, 'unknown'), owner_id, COALESCE(description, ''), pending_version, pending_request_id
         FROM sync_state ORDER BY name",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(InstalledPack {
            pack_id: row.get(0)?,
            name: row.get(1)?,
            local_path: row.get(2)?,
            version: row.get(3)?,
            last_synced: row.get(4)?,
            active: row.get::<_, i64>(5)? != 0,
            origin: row.get(6)?,
            owner_id: row.get(7)?,
            description: row.get(8)?,
            pending_version: row.get(9)?,
            pending_request_id: row.get(10)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_sync_state(conn: &Connection, pack_id: &str) -> AppResult<Option<InstalledPack>> {
    conn.query_row(
        "SELECT pack_id, name, local_path, version, last_synced, COALESCE(active, 1), COALESCE(origin, 'unknown'), owner_id, COALESCE(description, ''), pending_version, pending_request_id
         FROM sync_state WHERE pack_id = ?1",
        params![pack_id],
        |row| {
            Ok(InstalledPack {
                pack_id: row.get(0)?,
                name: row.get(1)?,
                local_path: row.get(2)?,
                version: row.get(3)?,
                last_synced: row.get(4)?,
                active: row.get::<_, i64>(5)? != 0,
                origin: row.get(6)?,
                owner_id: row.get(7)?,
                description: row.get(8)?,
                pending_version: row.get(9)?,
                pending_request_id: row.get(10)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

/// Records that `pack_id` has an unresolved publish request awaiting Hub
/// review. `version`/snapshot baseline are deliberately left untouched —
/// see `hub_publish_pack` for why.
pub fn set_pending_publish(
    conn: &Connection,
    pack_id: &str,
    request_id: &str,
    version: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE sync_state SET pending_request_id = ?1, pending_version = ?2 WHERE pack_id = ?3",
        params![request_id, version, pack_id],
    )?;
    Ok(())
}

/// Clears a resolved (approved or rejected) publish request's marker. Does
/// not touch `version`/snapshot — callers decide separately whether the
/// resolution also advances those (see `hub_reconcile_publish_requests`).
pub fn clear_pending_publish(conn: &Connection, pack_id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE sync_state SET pending_request_id = NULL, pending_version = NULL WHERE pack_id = ?1",
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

/// Renames a pack's identity in `sync_state` — `pack_id` and `local_path`
/// always move together (the vault-wide invariant is that a pack's folder
/// name *is* its id), leaving version/active/origin/owner_id/description
/// untouched.
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
    fn pending_publish_round_trips_through_get_and_list_sync_state() {
        let conn = seeded_conn();

        set_pending_publish(&conn, "sample", "req-1", "1.1.0").unwrap();
        let pending = get_sync_state(&conn, "sample").unwrap().unwrap();
        assert_eq!(pending.pending_request_id.as_deref(), Some("req-1"));
        assert_eq!(pending.pending_version.as_deref(), Some("1.1.0"));
        // `version` (the last-approved value) must stay untouched by a pending marker.
        assert_eq!(pending.version, "1.0.0");
        let listed = list_sync_state(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].pending_request_id.as_deref(), Some("req-1"));

        clear_pending_publish(&conn, "sample").unwrap();
        let cleared = get_sync_state(&conn, "sample").unwrap().unwrap();
        assert_eq!(cleared.pending_request_id, None);
        assert_eq!(cleared.pending_version, None);
        assert_eq!(cleared.version, "1.0.0", "clearing must not touch version");
    }
}
