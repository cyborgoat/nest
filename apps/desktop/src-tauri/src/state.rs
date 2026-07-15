use crate::error::AppResult;
use crate::vault;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
    vault_root: Mutex<PathBuf>,
    pub is_indexing: AtomicBool,
    pub chat_cancel: AtomicBool,
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

        Ok(Self {
            db: Mutex::new(db),
            app_data_dir,
            vault_root: Mutex::new(vault_root),
            is_indexing: AtomicBool::new(false),
            chat_cancel: AtomicBool::new(false),
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

    pub fn indexing(&self) -> bool {
        self.is_indexing.load(Ordering::SeqCst)
    }

    pub fn clear_chat_cancel(&self) {
        self.chat_cancel.store(false, Ordering::SeqCst);
    }

    pub fn request_chat_cancel(&self) {
        self.chat_cancel.store(true, Ordering::SeqCst);
    }

    pub fn chat_cancel_requested(&self) -> bool {
        self.chat_cancel.load(Ordering::SeqCst)
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
