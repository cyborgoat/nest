//! Lightweight local version control: a point-in-time mirror of a pack's
//! markdown content, taken at download/sync time and refreshed after a
//! successful publish. Working files are compared against this mirror to
//! compute per-file Modified/New/Deleted status and to render diffs —
//! there is no git repo or history here, just "current" vs. "last known
//! good", matching the desktop app's file-tree/vault model.

use crate::error::AppResult;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Root directory for all pack snapshots, kept outside the vault so it never
/// needs excluding from `copy_dir_recursive`/`export_pack`/tree-walk logic
/// and never leaks into publish ZIPs.
pub fn snapshot_root(app_data: &Path, pack_id: &str, version: &str) -> PathBuf {
    app_data.join("snapshots").join(pack_id).join(version)
}

/// Moves a pack's whole snapshot tree (every version) to a new pack_id —
/// needed when a local pack is renamed, since its identity (and therefore
/// its snapshot key) changes. A no-op if there's no snapshot yet (e.g. a
/// pack that was created locally and never published).
pub fn rename_snapshot_root(app_data: &Path, old_pack_id: &str, new_pack_id: &str) -> AppResult<()> {
    if old_pack_id == new_pack_id {
        return Ok(());
    }
    let old_dir = app_data.join("snapshots").join(old_pack_id);
    if !old_dir.exists() {
        return Ok(());
    }
    let new_dir = app_data.join("snapshots").join(new_pack_id);
    if new_dir.exists() {
        fs::remove_dir_all(&new_dir)?;
    }
    if let Some(parent) = new_dir.parent() {
        crate::vault::ensure_dir(parent)?;
    }
    fs::rename(old_dir, new_dir)?;
    Ok(())
}

/// Mirror a pack's current markdown content into its snapshot directory,
/// overwriting any prior snapshot for that pack_id+version. Only markdown
/// files matter for diffing (image/pack.json changes aren't part of the
/// M/N/D surface).
pub fn write_snapshot(app_data: &Path, pack_id: &str, version: &str, pack_dir: &Path) -> AppResult<()> {
    let dest = snapshot_root(app_data, pack_id, version);
    if dest.exists() {
        fs::remove_dir_all(&dest)?;
    }
    crate::vault::ensure_dir(&dest)?;

    let mut rel_paths = Vec::new();
    list_markdown_rel_paths(pack_dir, pack_dir, &mut rel_paths)?;
    for rel in rel_paths {
        let target = dest.join(&rel);
        if let Some(parent) = target.parent() {
            crate::vault::ensure_dir(parent)?;
        }
        fs::copy(pack_dir.join(&rel), &target)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeStatus {
    Modified,
    New,
    Deleted,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub status: FileChangeStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffPair {
    pub old: Option<String>,
    pub new: Option<String>,
}

fn list_markdown_rel_paths(root: &Path, dir: &Path, out: &mut Vec<String>) -> AppResult<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            list_markdown_rel_paths(root, &path, out)?;
        } else if crate::vault::is_markdown_path(&path) {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(rel);
        }
    }
    Ok(())
}

/// Compute per-file Modified/New/Deleted status for a pack by comparing its
/// working files against its snapshot. Unchanged files are omitted. If
/// `snapshot_dir` doesn't exist at all (e.g. a brand-new local pack that was
/// never downloaded), every working file is New and nothing is Deleted —
/// there is no baseline to compare against.
pub fn compute_status(pack_dir: &Path, snapshot_dir: &Path) -> AppResult<Vec<FileStatus>> {
    let mut working = Vec::new();
    list_markdown_rel_paths(pack_dir, pack_dir, &mut working)?;

    let has_snapshot = snapshot_dir.is_dir();
    let mut snapshotted = Vec::new();
    if has_snapshot {
        list_markdown_rel_paths(snapshot_dir, snapshot_dir, &mut snapshotted)?;
    }

    let mut statuses = Vec::new();
    for rel in &working {
        let snap_path = snapshot_dir.join(rel);
        if !has_snapshot || !snap_path.is_file() {
            statuses.push(FileStatus {
                path: rel.clone(),
                status: FileChangeStatus::New,
            });
            continue;
        }
        let working_bytes = fs::read(pack_dir.join(rel))?;
        let snap_bytes = fs::read(&snap_path)?;
        if working_bytes != snap_bytes {
            statuses.push(FileStatus {
                path: rel.clone(),
                status: FileChangeStatus::Modified,
            });
        }
    }
    for rel in &snapshotted {
        if !working.contains(rel) {
            statuses.push(FileStatus {
                path: rel.clone(),
                status: FileChangeStatus::Deleted,
            });
        }
    }
    statuses.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(statuses)
}

/// Read the (old, new) content pair for one file, for the diff view. Either
/// side may be absent: `old: None` means the file is New, `new: None` means
/// it was Deleted.
pub fn read_pair(pack_dir: &Path, snapshot_dir: &Path, rel_path: &str) -> AppResult<DiffPair> {
    let working_path = crate::vault::resolve_vault_path(pack_dir, rel_path)?;
    let new = if working_path.is_file() {
        Some(fs::read_to_string(&working_path)?)
    } else {
        None
    };

    let snap_path = snapshot_dir.join(rel_path);
    let old = if snap_path.is_file() {
        Some(fs::read_to_string(&snap_path)?)
    } else {
        None
    };

    Ok(DiffPair { old, new })
}

/// Revert one working file to its snapshot content (Modified/Deleted case),
/// or delete it if it has no snapshot counterpart (New case) — the caller
/// doesn't need to know which case applies ahead of time.
pub fn discard_file(pack_dir: &Path, snapshot_dir: &Path, rel_path: &str) -> AppResult<()> {
    let working_path = crate::vault::resolve_vault_path(pack_dir, rel_path)?;
    let snap_path = snapshot_dir.join(rel_path);
    if snap_path.is_file() {
        if let Some(parent) = working_path.parent() {
            crate::vault::ensure_dir(parent)?;
        }
        fs::copy(&snap_path, &working_path)?;
    } else if working_path.is_file() {
        fs::remove_file(&working_path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn scratch(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("nest-snapshot-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn write_snapshot_mirrors_markdown_only() {
        let app_data = scratch("write-app-data");
        let pack_dir = scratch("write-pack-dir");
        crate::vault::ensure_dir(&pack_dir.join("docs")).unwrap();
        fs::write(pack_dir.join("docs/a.md"), "# A").unwrap();
        fs::write(pack_dir.join("pack.json"), "{}").unwrap();

        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();

        let snap = snapshot_root(&app_data, "pack1", "1.0.0");
        assert!(snap.join("docs/a.md").is_file());
        assert!(!snap.join("pack.json").exists());
    }

    #[test]
    fn rename_snapshot_root_moves_every_version() {
        let app_data = scratch("rename-snapshot-app-data");
        let pack_dir = scratch("rename-snapshot-pack-dir");
        crate::vault::ensure_dir(&pack_dir).unwrap();
        fs::write(pack_dir.join("a.md"), "# A").unwrap();
        write_snapshot(&app_data, "old-id", "1.0.0", &pack_dir).unwrap();
        write_snapshot(&app_data, "old-id", "2.0.0", &pack_dir).unwrap();

        rename_snapshot_root(&app_data, "old-id", "new-id").unwrap();

        assert!(!app_data.join("snapshots").join("old-id").exists());
        assert!(snapshot_root(&app_data, "new-id", "1.0.0")
            .join("a.md")
            .is_file());
        assert!(snapshot_root(&app_data, "new-id", "2.0.0")
            .join("a.md")
            .is_file());
    }

    #[test]
    fn rename_snapshot_root_is_a_noop_without_an_existing_snapshot() {
        let app_data = scratch("rename-snapshot-noop");
        // Never wrote a snapshot for "old-id" — must not error.
        rename_snapshot_root(&app_data, "old-id", "new-id").unwrap();
    }

    #[test]
    fn compute_status_reports_modified_new_and_deleted() {
        let app_data = scratch("status-app-data");
        let pack_dir = scratch("status-pack-dir");
        crate::vault::ensure_dir(&pack_dir).unwrap();
        fs::write(pack_dir.join("keep.md"), "unchanged").unwrap();
        fs::write(pack_dir.join("edit.md"), "original").unwrap();
        fs::write(pack_dir.join("gone.md"), "will be deleted").unwrap();

        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();
        let snap_dir = snapshot_root(&app_data, "pack1", "1.0.0");

        // Mutate the working copy after the snapshot was taken.
        fs::write(pack_dir.join("edit.md"), "changed").unwrap();
        fs::remove_file(pack_dir.join("gone.md")).unwrap();
        fs::write(pack_dir.join("new.md"), "brand new").unwrap();

        let statuses = compute_status(&pack_dir, &snap_dir).unwrap();
        assert_eq!(statuses.len(), 3);
        assert!(statuses
            .iter()
            .any(|s| s.path == "edit.md" && s.status == FileChangeStatus::Modified));
        assert!(statuses
            .iter()
            .any(|s| s.path == "gone.md" && s.status == FileChangeStatus::Deleted));
        assert!(statuses
            .iter()
            .any(|s| s.path == "new.md" && s.status == FileChangeStatus::New));
    }

    #[test]
    fn compute_status_with_no_snapshot_marks_everything_new() {
        let pack_dir = scratch("status-no-snapshot-pack");
        crate::vault::ensure_dir(&pack_dir).unwrap();
        fs::write(pack_dir.join("readme.md"), "# hi").unwrap();
        let missing_snapshot = scratch("status-no-snapshot-missing");

        let statuses = compute_status(&pack_dir, &missing_snapshot).unwrap();
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].status, FileChangeStatus::New);
    }

    #[test]
    fn read_pair_reports_new_and_deleted_correctly() {
        let app_data = scratch("pair-app-data");
        let pack_dir = scratch("pair-pack-dir");
        crate::vault::ensure_dir(&pack_dir).unwrap();
        fs::write(pack_dir.join("a.md"), "old content").unwrap();
        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();
        let snap_dir = snapshot_root(&app_data, "pack1", "1.0.0");

        fs::write(pack_dir.join("a.md"), "new content").unwrap();
        fs::write(pack_dir.join("b.md"), "brand new file").unwrap();
        fs::remove_file(pack_dir.join("a.md")).unwrap();
        fs::write(pack_dir.join("a.md"), "new content").unwrap();

        let modified = read_pair(&pack_dir, &snap_dir, "a.md").unwrap();
        assert_eq!(modified.old.as_deref(), Some("old content"));
        assert_eq!(modified.new.as_deref(), Some("new content"));

        let new_file = read_pair(&pack_dir, &snap_dir, "b.md").unwrap();
        assert_eq!(new_file.old, None);
        assert_eq!(new_file.new.as_deref(), Some("brand new file"));
    }

    #[test]
    fn discard_file_reverts_modified_and_deletes_new() {
        let app_data = scratch("discard-app-data");
        let pack_dir = scratch("discard-pack-dir");
        crate::vault::ensure_dir(&pack_dir).unwrap();
        fs::write(pack_dir.join("a.md"), "original").unwrap();
        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();
        let snap_dir = snapshot_root(&app_data, "pack1", "1.0.0");

        fs::write(pack_dir.join("a.md"), "edited").unwrap();
        fs::write(pack_dir.join("b.md"), "new file").unwrap();

        discard_file(&pack_dir, &snap_dir, "a.md").unwrap();
        assert_eq!(fs::read_to_string(pack_dir.join("a.md")).unwrap(), "original");

        discard_file(&pack_dir, &snap_dir, "b.md").unwrap();
        assert!(!pack_dir.join("b.md").exists());
    }
}
