use crate::error::AppResult;
use crate::hub::AuthSession;
use crate::vault;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::watch;

/// Background indexing progress: whether a pass is running now, and the
/// requested-vs-completed generation counters `indexing::schedule` uses to
/// coalesce overlapping rebuild requests into one trailing pass.
struct IndexingState {
    is_indexing: AtomicBool,
    index_generation: AtomicU64,
    indexed_generation: AtomicU64,
    successful_generation: AtomicU64,
}

impl IndexingState {
    fn new() -> Self {
        Self {
            is_indexing: AtomicBool::new(false),
            index_generation: AtomicU64::new(0),
            indexed_generation: AtomicU64::new(0),
            successful_generation: AtomicU64::new(0),
        }
    }
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
    vault_root: Mutex<PathBuf>,
    indexing: IndexingState,
    chat_cancel: watch::Sender<bool>,
    claude_cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub claude_connection: Mutex<Option<crate::db::ClaudeConnectionReport>>,
    pub hub_auth: Mutex<Option<AuthSession>>,
    pub hub_auth_refresh: tokio::sync::Mutex<()>,
    pub mcp: Mutex<Option<McpRuntime>>,
    operation_slot: Mutex<Option<OperationLease>>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    ChatTurn,
    ConnectionProbe,
    SaveClaudeSettings,
    Reindex,
    VaultSwitch,
    DeleteSession,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OperationStatus {
    pub kind: OperationKind,
    pub owner: String,
    pub started_at: String,
}

struct OperationLease {
    id: String,
    status: OperationStatus,
}

pub struct OperationGuard {
    state: SharedState,
    id: String,
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        let mut slot = self.state.operation_slot.lock();
        if slot.as_ref().is_some_and(|lease| lease.id == self.id) {
            *slot = None;
        }
    }
}

pub struct McpRuntime {
    pub server: Arc<crate::claude_mcp::McpServerState>,
    pub handle: crate::claude_mcp::McpServerHandle,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Self> {
        vault::ensure_dir(&app_data_dir)?;
        let db_path = app_data_dir.join("nest.db");
        let db = crate::db::open_db(&db_path)?;
        crate::db::recover_interrupted_turns(&db)?;

        let settings = {
            let conn = &db;
            crate::db::get_settings(conn)?
        };
        let vault_root = resolve_knowledge_dir(&app_data_dir, &settings.knowledge_dir);
        vault::ensure_dir(&vault_root)?;
        crate::default_pack::ensure_seeded(&db, &app_data_dir, &vault_root)?;
        crate::knowledge_review::recover_claimed_changes(&db, &vault_root)?;

        Ok(Self {
            db: Mutex::new(db),
            app_data_dir,
            vault_root: Mutex::new(vault_root),
            indexing: IndexingState::new(),
            chat_cancel: watch::channel(false).0,
            claude_cancel: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            claude_connection: Mutex::new(None),
            hub_auth: Mutex::new(None),
            hub_auth_refresh: tokio::sync::Mutex::new(()),
            mcp: Mutex::new(None),
            operation_slot: Mutex::new(None),
        })
    }

    pub async fn ensure_mcp_server(self: &Arc<Self>) -> AppResult<()> {
        {
            let existing = self.mcp.lock();
            if existing.is_some() {
                return Ok(());
            }
        }
        let server = crate::claude_mcp::McpServerState::new(self.clone());
        let handle = crate::claude_mcp::start_server(server.clone()).await?;
        *self.mcp.lock() = Some(McpRuntime { server, handle });
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn stop_mcp_server(&self) {
        let runtime = self.mcp.lock().take();
        if let Some(runtime) = runtime {
            runtime.handle.stop().await;
        }
    }

    pub fn begin_operation(
        self: &Arc<Self>,
        kind: OperationKind,
        owner: impl Into<String>,
    ) -> AppResult<OperationGuard> {
        let mut slot = self.operation_slot.lock();
        if let Some(active) = slot.as_ref() {
            return Err(crate::error::AppError::msg(format!(
                "operation_busy: {} is already running for {}",
                operation_kind_name(&active.status.kind),
                active.status.owner
            )));
        }
        let id = uuid::Uuid::new_v4().to_string();
        *slot = Some(OperationLease {
            id: id.clone(),
            status: OperationStatus {
                kind,
                owner: owner.into(),
                started_at: chrono::Utc::now().to_rfc3339(),
            },
        });
        Ok(OperationGuard {
            state: self.clone(),
            id,
        })
    }

    pub fn operation_status(&self) -> Option<OperationStatus> {
        self.operation_slot
            .lock()
            .as_ref()
            .map(|lease| lease.status.clone())
    }

    pub fn ensure_no_operation(&self) -> crate::error::AppResult<()> {
        if let Some(active) = self.operation_status() {
            return Err(crate::error::AppError::msg(format!(
                "operation_busy: {} is running for {}",
                operation_kind_name(&active.kind),
                active.owner
            )));
        }
        Ok(())
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
        self.indexing.is_indexing.store(value, Ordering::SeqCst);
    }

    pub fn try_begin_indexing(&self) -> bool {
        self.indexing
            .is_indexing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn indexing(&self) -> bool {
        self.indexing.is_indexing.load(Ordering::SeqCst)
    }

    pub fn request_index_rebuild(&self) -> u64 {
        self.indexing
            .index_generation
            .fetch_add(1, Ordering::SeqCst)
            + 1
    }

    pub fn requested_index_generation(&self) -> u64 {
        self.indexing.index_generation.load(Ordering::SeqCst)
    }

    pub fn mark_index_generation_complete(&self, generation: u64, succeeded: bool) {
        self.indexing
            .indexed_generation
            .store(generation, Ordering::SeqCst);
        if succeeded {
            self.indexing
                .successful_generation
                .store(generation, Ordering::SeqCst);
        }
    }

    pub fn indexed_generation(&self) -> u64 {
        self.indexing.indexed_generation.load(Ordering::SeqCst)
    }

    pub fn successful_index_generation(&self) -> u64 {
        self.indexing.successful_generation.load(Ordering::SeqCst)
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
        self.claude_cancel
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn begin_chat_cancel_arc(&self) -> std::sync::Arc<std::sync::atomic::AtomicBool> {
        self.chat_cancel.send_replace(false);
        self.claude_cancel
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.claude_cancel.clone()
    }
}

fn operation_kind_name(kind: &OperationKind) -> &'static str {
    match kind {
        OperationKind::ChatTurn => "chat_turn",
        OperationKind::ConnectionProbe => "connection_probe",
        OperationKind::SaveClaudeSettings => "save_claude_settings",
        OperationKind::Reindex => "reindex",
        OperationKind::VaultSwitch => "vault_switch",
        OperationKind::DeleteSession => "delete_session",
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

#[cfg(test)]
mod operation_tests {
    use super::*;

    fn state() -> SharedState {
        Arc::new(
            AppState::new(
                std::env::temp_dir().join(format!("nest-operation-{}", uuid::Uuid::new_v4())),
            )
            .unwrap(),
        )
    }

    #[test]
    fn operation_guard_is_exclusive_and_owner_aware() {
        let state = state();
        let guard = state
            .begin_operation(OperationKind::ChatTurn, "session-a")
            .unwrap();
        let status = state.operation_status().unwrap();
        assert_eq!(status.kind, OperationKind::ChatTurn);
        assert_eq!(status.owner, "session-a");
        assert!(state
            .begin_operation(OperationKind::Reindex, "workspace")
            .is_err());
        drop(guard);
        assert!(state.operation_status().is_none());
        assert!(state
            .begin_operation(OperationKind::Reindex, "workspace")
            .is_ok());
    }
}
