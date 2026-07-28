use crate::error::AppResult;
use crate::hub::AuthSession;
use crate::vault;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::watch;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
    vault_root: Mutex<PathBuf>,
    pub is_indexing: AtomicBool,
    index_generation: AtomicU64,
    indexed_generation: AtomicU64,
    chat_cancel: watch::Sender<bool>,
    pub hub_auth: Mutex<Option<AuthSession>>,
    pub hub_auth_refresh: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Self> {
        vault::ensure_dir(&app_data_dir)?;
        let db_path = app_data_dir.join("nest.db");
        let db = crate::db::open_db(&db_path)?;

        let settings = {
            let conn = &db;
            crate::db::get_settings(conn)?
        };
        let vault_root = resolve_knowledge_dir(&app_data_dir, &settings.knowledge_dir);
        vault::ensure_dir(&vault_root)?;
        crate::default_pack::ensure_seeded(&db, &app_data_dir, &vault_root)?;

        Ok(Self {
            db: Mutex::new(db),
            app_data_dir,
            vault_root: Mutex::new(vault_root),
            is_indexing: AtomicBool::new(false),
            index_generation: AtomicU64::new(0),
            indexed_generation: AtomicU64::new(0),
            chat_cancel: watch::channel(false).0,
            hub_auth: Mutex::new(None),
            hub_auth_refresh: tokio::sync::Mutex::new(()),
        })
    }

    pub fn vault_path(&self) -> PathBuf {
        self.vault_root.lock().clone()
    }

    pub fn set_vault_path(&self, path: PathBuf) -> AppResult<()> {
        vault::ensure_dir(&path)?;
        *self.vault_root.lock() = path;
        Ok(())
    }

    pub fn set_indexing(&self, value: bool) {
        self.is_indexing.store(value, Ordering::SeqCst);
    }

    pub fn try_begin_indexing(&self) -> bool {
        self.is_indexing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn indexing(&self) -> bool {
        self.is_indexing.load(Ordering::SeqCst)
    }

    pub fn request_index_rebuild(&self) -> u64 {
        self.index_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn requested_index_generation(&self) -> u64 {
        self.index_generation.load(Ordering::SeqCst)
    }

    pub fn mark_index_generation_complete(&self, generation: u64) {
        self.indexed_generation.store(generation, Ordering::SeqCst);
    }

    pub fn indexed_generation(&self) -> u64 {
        self.indexed_generation.load(Ordering::SeqCst)
    }

    /// Begin a chat generation with a fresh cancellation receiver. A watch
    /// channel preserves a stop request even if it arrives before the stream is
    /// waiting for the next token.
    pub fn begin_chat_cancel(&self) -> watch::Receiver<bool> {
        self.chat_cancel.send_replace(false);
        self.chat_cancel.subscribe()
    }

    pub fn request_chat_cancel(&self) {
        self.chat_cancel.send_replace(true);
    }
}

/// Empty / whitespace `knowledge_dir` → default `{app_data}/vault`.
pub fn resolve_knowledge_dir(app_data: &Path, knowledge_dir: &str) -> PathBuf {
    let trimmed = knowledge_dir.trim();
    if trimmed.is_empty() {
        vault::vault_root(app_data)
    } else {
        PathBuf::from(trimmed)
    }
}

pub type SharedState = Arc<AppState>;
