use crate::error::AppResult;
use crate::vault;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
    pub vault_root: PathBuf,
    pub fixtures_root: PathBuf,
    pub is_indexing: AtomicBool,
    pub chat_cancel: AtomicBool,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf, fixtures_root: PathBuf) -> AppResult<Self> {
        vault::ensure_dir(&app_data_dir)?;
        let vault_root = vault::vault_root(&app_data_dir);
        vault::ensure_dir(&vault_root)?;
        let db_path = app_data_dir.join("nest.db");
        let db = crate::db::open_db(&db_path)?;
        Ok(Self {
            db: Mutex::new(db),
            app_data_dir,
            vault_root,
            fixtures_root,
            is_indexing: AtomicBool::new(false),
            chat_cancel: AtomicBool::new(false),
        })
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

pub type SharedState = Arc<AppState>;
