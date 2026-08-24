use crate::db;
use crate::error::AppResult;
use crate::state::SharedState;
use rusqlite::OptionalExtension;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub const WORKSPACE_HEALTH_KEY: &str = "workspace_health_v1";
const WORKSPACE_MANIFEST_KEY: &str = "workspace_manifest_v1";

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct VaultManifest {
    files: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ManifestDiff {
    created: Vec<String>,
    modified: Vec<String>,
    deleted: Vec<String>,
}

impl VaultManifest {
    #[cfg(test)]
    fn from_entries<const N: usize>(entries: [(&str, &str); N]) -> Self {
        Self {
            files: entries
                .into_iter()
                .map(|(path, hash)| (path.to_string(), hash.to_string()))
                .collect(),
        }
    }

    fn diff(&self, current: &Self) -> ManifestDiff {
        let previous_paths = self.files.keys().cloned().collect::<BTreeSet<_>>();
        let current_paths = current.files.keys().cloned().collect::<BTreeSet<_>>();
        ManifestDiff {
            created: current_paths.difference(&previous_paths).cloned().collect(),
            modified: previous_paths
                .intersection(&current_paths)
                .filter(|path| self.files.get(*path) != current.files.get(*path))
                .cloned()
                .collect(),
            deleted: previous_paths.difference(&current_paths).cloned().collect(),
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceHealth {
    #[allow(dead_code)]
    pub reindex_required: bool,
    pub reason: Option<String>,
    pub updated_at: Option<String>,
}

pub fn load_health(state: &SharedState) -> WorkspaceHealth {
    let conn = state.db.lock();
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![WORKSPACE_HEALTH_KEY],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|value: String| serde_json::from_str(&value).ok())
    .unwrap_or_default()
}

fn save_health(state: &SharedState, health: &WorkspaceHealth) -> AppResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![WORKSPACE_HEALTH_KEY, serde_json::to_string(health)?],
    )?;
    Ok(())
}

fn load_manifest(state: &SharedState) -> AppResult<Option<VaultManifest>> {
    let conn = state.db.lock();
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![WORKSPACE_MANIFEST_KEY],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(Into::into)
    .and_then(|value| {
        value
            .map(|json| serde_json::from_str(&json).map_err(Into::into))
            .transpose()
    })
}

fn save_manifest(state: &SharedState, manifest: &VaultManifest) -> AppResult<()> {
    let conn = state.db.lock();
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![WORKSPACE_MANIFEST_KEY, serde_json::to_string(manifest)?],
    )?;
    Ok(())
}

pub fn set_reindex_required(state: &SharedState, reason: &str) -> AppResult<()> {
    let mut health = load_health(state);
    health.reindex_required = true;
    health.reason = Some(reason.to_string());
    health.updated_at = Some(chrono::Utc::now().to_rfc3339());
    save_health(state, &health)
}

#[allow(dead_code)]
pub fn clear_reindex_required(state: &SharedState) -> AppResult<()> {
    let mut health = load_health(state);
    health.reindex_required = false;
    health.reason = None;
    health.updated_at = Some(chrono::Utc::now().to_rfc3339());
    save_health(state, &health)
}

pub struct ReconcileReport {
    #[allow(dead_code)]
    pub rebased: usize,
    #[allow(dead_code)]
    pub conflicted: usize,
    #[allow(dead_code)]
    pub resolved_external: usize,
    #[allow(dead_code)]
    pub reindex_required: bool,
    pub created: Vec<String>,
    pub modified: Vec<String>,
    pub deleted: Vec<String>,
}

fn content_digest(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn snapshot_manifest(vault_root: &Path, prefixes: &[String]) -> AppResult<VaultManifest> {
    let mut files = BTreeMap::new();
    for prefix in prefixes {
        let root = vault_root.join(prefix);
        if !root.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&root) {
            let entry = entry.map_err(|error| {
                crate::error::AppError::msg(format!("workspace manifest scan failed: {error}"))
            })?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let rel = match path.strip_prefix(vault_root) {
                Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            if !crate::vault::is_markdown_path(&rel) {
                continue;
            }
            let bytes = std::fs::read(path)?;
            files.insert(rel, content_digest(&bytes));
        }
    }
    Ok(VaultManifest { files })
}

fn inspect_vault(state: &SharedState) -> AppResult<(ReconcileReport, VaultManifest, bool)> {
    let vault_root = state.vault_path();
    let pending_changes = {
        let conn = state.db.lock();
        db::list_pending_chat_file_changes(&conn)?
    };
    let mut report = ReconcileReport {
        rebased: 0,
        conflicted: 0,
        resolved_external: 0,
        reindex_required: false,
        created: Vec::new(),
        modified: Vec::new(),
        deleted: Vec::new(),
    };
    for change in &pending_changes {
        match crate::knowledge_review::reconcile_pending_change(state, change) {
            Ok(crate::knowledge_review::ReconcileOutcome::Rebased) => report.rebased += 1,
            Ok(crate::knowledge_review::ReconcileOutcome::Conflicted) => report.conflicted += 1,
            Ok(crate::knowledge_review::ReconcileOutcome::ResolvedExternal) => {
                report.resolved_external += 1
            }
            Ok(crate::knowledge_review::ReconcileOutcome::Unchanged) => {}
            Err(_) => {
                report.conflicted += 1;
            }
        }
    }

    let prefixes: Vec<String> = {
        let conn = state.db.lock();
        db::list_sync_state(&conn)?
            .into_iter()
            .filter(|pack| pack.active)
            .map(|pack| pack.local_path)
            .collect()
    };
    let current = snapshot_manifest(&vault_root, &prefixes)?;
    let previous = load_manifest(state)?;
    let baseline_missing = previous.is_none();
    let previous = previous.unwrap_or_default();
    let diff = previous.diff(&current);
    report.created = diff.created;
    report.modified = diff.modified;
    report.deleted = diff.deleted;
    let changed = baseline_missing
        || !report.created.is_empty()
        || !report.modified.is_empty()
        || !report.deleted.is_empty();
    Ok((report, current, changed))
}

async fn reconcile_with_policy(
    state: &SharedState,
    timeout: std::time::Duration,
    force_reindex: bool,
) -> AppResult<ReconcileReport> {
    let result = async {
        let (mut report, current, changed) = inspect_vault(state)?;
        let needs_reindex = force_reindex || changed || load_health(state).reindex_required;
        if needs_reindex {
            set_reindex_required(state, "workspace reconciliation is rebuilding the index")?;
            crate::indexing::schedule_and_wait(state, timeout).await?;
            save_manifest(state, &current)?;
            clear_reindex_required(state)?;
        }
        report.reindex_required = false;
        Ok(report)
    }
    .await;
    if let Err(error) = &result {
        let _ = set_reindex_required(state, &format!("workspace_reconciliation_failed: {error}"));
    }
    result
}

pub async fn reconcile_vault(
    state: &SharedState,
    timeout: std::time::Duration,
) -> AppResult<ReconcileReport> {
    reconcile_with_policy(state, timeout, false).await
}

pub async fn restore_workspace(
    state: &SharedState,
    timeout: std::time::Duration,
) -> AppResult<WorkspaceHealth> {
    reconcile_with_policy(state, timeout, true).await?;
    Ok(load_health(state))
}

pub fn ensure_workspace_healthy(state: &SharedState) -> AppResult<()> {
    let health = load_health(state);
    if health.reindex_required {
        return Err(crate::error::AppError::msg(format!(
            "nest_knowledge_reindex_required: {}",
            health
                .reason
                .unwrap_or_else(|| "index rebuild required".into())
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn manifest_diff_reports_modified_and_deleted_markdown() {
        let previous =
            VaultManifest::from_entries([("pack/keep.md", "hash-a"), ("pack/delete.md", "hash-b")]);
        let current = VaultManifest::from_entries([("pack/keep.md", "hash-c")]);

        let diff = previous.diff(&current);

        assert_eq!(diff.modified, vec!["pack/keep.md"]);
        assert_eq!(diff.deleted, vec!["pack/delete.md"]);
        assert!(diff.created.is_empty());
    }

    #[test]
    fn reindex_flag_round_trips_and_clears() {
        let state = Arc::new(
            crate::state::AppState::new(
                std::env::temp_dir().join(format!("nest-health-{}", uuid::Uuid::new_v4())),
            )
            .unwrap(),
        );
        assert!(!load_health(&state).reindex_required);
        set_reindex_required(&state, "scan failed").unwrap();
        let health = load_health(&state);
        assert!(health.reindex_required);
        assert_eq!(health.reason.as_deref(), Some("scan failed"));
        ensure_workspace_healthy(&state).unwrap_err();
        clear_reindex_required(&state).unwrap();
        assert!(!load_health(&state).reindex_required);
        ensure_workspace_healthy(&state).unwrap();
    }

    #[tokio::test]
    async fn restore_clears_health_only_after_index_and_manifest_commit() {
        let state = Arc::new(
            crate::state::AppState::new(
                std::env::temp_dir().join(format!("nest-restore-{}", uuid::Uuid::new_v4())),
            )
            .unwrap(),
        );
        set_reindex_required(&state, "test recovery").unwrap();

        let health = restore_workspace(&state, std::time::Duration::from_secs(60))
            .await
            .unwrap();

        assert!(!health.reindex_required);
        assert!(load_manifest(&state).unwrap().is_some());
        assert!(!state.indexing());
    }

    #[tokio::test]
    async fn reconciliation_indexes_modified_and_deleted_files() {
        let state = Arc::new(
            crate::state::AppState::new(
                std::env::temp_dir().join(format!("nest-manifest-{}", uuid::Uuid::new_v4())),
            )
            .unwrap(),
        );
        let path = "manifest-test/note.md";
        std::fs::create_dir_all(state.vault_path().join("manifest-test")).unwrap();
        std::fs::write(state.vault_path().join(path), "original marker").unwrap();
        {
            let conn = state.db.lock();
            db::upsert_sync_state(
                &conn,
                db::SyncStateUpsert {
                    pack_id: "manifest-test",
                    name: "Manifest test",
                    version: "1.0.0",
                    local_path: "manifest-test",
                    origin: "local",
                    owner_id: None,
                    description: "",
                    patch_revision: 0,
                },
            )
            .unwrap();
        }
        restore_workspace(&state, std::time::Duration::from_secs(60))
            .await
            .unwrap();

        std::fs::write(state.vault_path().join(path), "updated marker").unwrap();
        let modified = reconcile_vault(&state, std::time::Duration::from_secs(60))
            .await
            .unwrap();
        assert_eq!(modified.modified, vec![path]);

        std::fs::remove_file(state.vault_path().join(path)).unwrap();
        let deleted = reconcile_vault(&state, std::time::Duration::from_secs(60))
            .await
            .unwrap();
        assert_eq!(deleted.deleted, vec![path]);
    }

    #[tokio::test]
    async fn timed_out_restore_keeps_workspace_degraded() {
        let state = Arc::new(
            crate::state::AppState::new(
                std::env::temp_dir().join(format!("nest-timeout-{}", uuid::Uuid::new_v4())),
            )
            .unwrap(),
        );

        let error = restore_workspace(&state, std::time::Duration::ZERO)
            .await
            .unwrap_err();

        assert!(error.to_string().contains("workspace_reindex_timeout"));
        assert!(load_health(&state).reindex_required);
    }
}
