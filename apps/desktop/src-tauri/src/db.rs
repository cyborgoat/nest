use crate::error::{AppError, AppResult};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub llm_base_url: String,
    pub llm_api_key: String,
    pub chat_model: String,
    pub embedding_model: String,
    pub hub_base_url: String,
    /// Optional HTTP(S)/SOCKS5 proxy for Hub (and title) outbound requests.
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default = "default_font_size_pt")]
    pub font_size_pt: u32,
    #[serde(default = "default_display_language")]
    pub display_language: String,
    #[serde(default)]
    pub user_name: String,
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
            llm_base_url: "https://api.openai.com/v1".into(),
            llm_api_key: String::new(),
            chat_model: "gpt-4o-mini".into(),
            embedding_model: crate::embeddings::DEFAULT_EMBEDDING_MODEL.into(),
            hub_base_url: String::new(),
            proxy_url: String::new(),
            font_size_pt: default_font_size_pt(),
            display_language: default_display_language(),
            user_name: String::new(),
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
}

fn default_true() -> bool {
    true
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
            active INTEGER NOT NULL DEFAULT 1
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
            "embedding_model" | "embeddings_model" => settings.embedding_model = value,
            "hub_base_url" => settings.hub_base_url = value,
            "proxy_url" => settings.proxy_url = value,
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
            "user_name" => settings.user_name = value,
            "knowledge_dir" => settings.knowledge_dir = value,
            // legacy "top_k" rows ignored — retrieval uses DEFAULT_TOP_K
            _ => {}
        }
    }
    Ok(settings)
}

pub fn save_settings(conn: &Connection, settings: &AppSettings) -> AppResult<()> {
    let pairs = [
        ("llm_base_url", settings.llm_base_url.clone()),
        ("llm_api_key", settings.llm_api_key.clone()),
        ("chat_model", settings.chat_model.clone()),
        ("embedding_model", settings.embedding_model.clone()),
        ("hub_base_url", settings.hub_base_url.clone()),
        ("proxy_url", settings.proxy_url.trim().to_string()),
        ("font_size_pt", settings.font_size_pt.to_string()),
        ("display_language", settings.display_language.clone()),
        ("user_name", settings.user_name.clone()),
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

pub fn set_index_meta(
    conn: &Connection,
    files: u32,
    chunks: u32,
    message: Option<&str>,
) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE index_meta SET indexed_files = ?1, indexed_chunks = ?2, last_indexed_at = ?3, message = ?4 WHERE id = 1",
        params![files, chunks, now, message],
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

fn snippet(content: &str) -> String {
    if content.len() > 280 {
        format!("{}…", &content[..280])
    } else {
        content.to_string()
    }
}

pub fn fts_search(
    conn: &Connection,
    query: &str,
    limit: u32,
    retrieval_prefixes: &[String],
) -> AppResult<Vec<Citation>> {
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
        Ok(Citation {
            chunk_id: row.get(0)?,
            file_path: row.get(1)?,
            title: row.get(2)?,
            snippet: snippet(&content),
            score: (-bm as f32).max(0.01),
        })
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
) -> AppResult<Vec<Citation>> {
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

    let mut scored: Vec<Citation> = Vec::new();
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
            scored.push(Citation {
                chunk_id: id,
                file_path: path,
                title,
                snippet: snippet(&content),
                score,
            });
        }
    }

    scored.sort_by(|a, b| {
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

pub fn upsert_sync_state(
    conn: &Connection,
    pack_id: &str,
    name: &str,
    version: &str,
    local_path: &str,
) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    // Preserve active flag on upgrade; new packs default to active=1.
    conn.execute(
        "INSERT INTO sync_state (pack_id, name, version, local_path, last_synced, active)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT(pack_id) DO UPDATE SET
           name = excluded.name,
           version = excluded.version,
           local_path = excluded.local_path,
           last_synced = excluded.last_synced",
        params![pack_id, name, version, local_path, now],
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
        "SELECT pack_id, name, local_path, version, last_synced, COALESCE(active, 1)
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
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_sync_state(conn: &Connection, pack_id: &str) -> AppResult<Option<InstalledPack>> {
    conn.query_row(
        "SELECT pack_id, name, local_path, version, last_synced, COALESCE(active, 1)
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
            })
        },
    )
    .optional()
    .map_err(Into::into)
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

/// Remove chunks, FTS rows, and sync state for a vault path prefix.
pub fn purge_path_data(conn: &Connection, path: &str) -> AppResult<()> {
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

    conn.execute(
        "DELETE FROM sync_state WHERE pack_id = ?1 OR local_path = ?1 OR local_path LIKE ?2",
        params![exact, prefix],
    )?;

    recount_index_meta(conn)?;
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
