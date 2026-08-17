//! Pack working-tree status / diff / discard against the snapshot baseline.

use super::super::ensure_pack_not_review_locked;
use super::require_installed_pack;
use crate::error::{AppError, AppResult};
use crate::indexing;
use crate::state::SharedState;
use tauri::State;

fn pack_dirs(
    state: &SharedState,
    pack_id: &str,
) -> AppResult<(std::path::PathBuf, std::path::PathBuf, String)> {
    let installed = {
        let conn = state.db.lock();
        require_installed_pack(&conn, pack_id)?
    };
    let pack_dir = state.vault_path().join(&installed.local_path);
    let snapshot_dir =
        crate::snapshot::snapshot_root(&state.app_data_dir, &installed.pack_id, &installed.version);
    Ok((pack_dir, snapshot_dir, installed.local_path))
}

/// Strip a pack's `local_path/` prefix from a vault-relative path. Errors if
/// the path isn't actually under that prefix (defends against a stale tab
/// sending a path that belongs to a different pack).
fn strip_pack_prefix(local_path: &str, vault_relative: &str) -> AppResult<String> {
    vault_relative
        .strip_prefix(local_path)
        .and_then(|rest| rest.strip_prefix('/'))
        .map(str::to_string)
        .ok_or_else(|| AppError::msg(format!("Path is not inside this pack: {vault_relative}")))
}

#[tauri::command]
pub fn hub_pack_change_status(
    state: State<'_, SharedState>,
    pack_id: String,
) -> AppResult<Vec<crate::snapshot::FileStatus>> {
    let (pack_dir, snapshot_dir, local_path) = pack_dirs(&state, &pack_id)?;
    let mut statuses = crate::snapshot::compute_status(&pack_dir, &snapshot_dir)?;
    for status in &mut statuses {
        status.path = format!("{local_path}/{}", status.path);
    }
    Ok(statuses)
}

#[tauri::command]
pub fn hub_pack_file_diff(
    state: State<'_, SharedState>,
    pack_id: String,
    path: String,
) -> AppResult<crate::snapshot::DiffPair> {
    let (pack_dir, snapshot_dir, local_path) = pack_dirs(&state, &pack_id)?;
    let pack_relative = strip_pack_prefix(&local_path, &path)?;
    crate::snapshot::read_pair(&pack_dir, &snapshot_dir, &pack_relative)
}

#[tauri::command]
pub fn hub_pack_discard_file(
    state: State<'_, SharedState>,
    pack_id: String,
    path: String,
) -> AppResult<()> {
    {
        let conn = state.db.lock();
        let installed = require_installed_pack(&conn, &pack_id)?;
        ensure_pack_not_review_locked(&installed)?;
    }
    let (pack_dir, snapshot_dir, local_path) = pack_dirs(&state, &pack_id)?;
    let pack_relative = strip_pack_prefix(&local_path, &path)?;
    crate::snapshot::discard_file(&pack_dir, &snapshot_dir, &pack_relative)?;
    indexing::schedule(state.inner())?;
    Ok(())
}

/// Revert every changed file in a pack back to its snapshot baseline (or
/// delete it, for New files) in one go — the bulk counterpart of
/// `hub_pack_discard_file` for the pack-root "Discard all" action.
#[tauri::command]
pub fn hub_pack_discard_all(state: State<'_, SharedState>, pack_id: String) -> AppResult<()> {
    {
        let conn = state.db.lock();
        let installed = require_installed_pack(&conn, &pack_id)?;
        ensure_pack_not_review_locked(&installed)?;
    }
    let (pack_dir, snapshot_dir, _local_path) = pack_dirs(&state, &pack_id)?;
    let statuses = crate::snapshot::compute_status(&pack_dir, &snapshot_dir)?;
    for status in &statuses {
        crate::snapshot::discard_file(&pack_dir, &snapshot_dir, &status.path)?;
    }
    indexing::schedule(state.inner())?;
    Ok(())
}

#[cfg(test)]
mod pack_prefix_tests {
    use super::*;

    #[test]
    fn strips_matching_local_path_prefix() {
        assert_eq!(
            strip_pack_prefix("my-pack", "my-pack/docs/a.md").unwrap(),
            "docs/a.md"
        );
    }

    #[test]
    fn rejects_paths_outside_the_pack() {
        assert!(strip_pack_prefix("my-pack", "other-pack/docs/a.md").is_err());
        assert!(strip_pack_prefix("my-pack", "my-pack-extra/a.md").is_err());
        assert!(strip_pack_prefix("my-pack", "my-pack").is_err());
    }
}
