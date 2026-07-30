//! Lightweight local version control: a point-in-time mirror of a pack's
//! pack content, taken at download/sync time and refreshed after a
//! an explicit merge of an approved publish. Working files are compared against this mirror to
//! compute per-file Modified/New/Deleted status and to render diffs —
//! there is no git repo or history here, just "current" vs. "last known
//! good", matching the desktop app's file-tree/vault model.

use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::hash::{Hash, Hasher};
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
pub fn rename_snapshot_root(
    app_data: &Path,
    old_pack_id: &str,
    new_pack_id: &str,
) -> AppResult<()> {
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

/// Mirror every regular pack file into its snapshot directory. Symlinked
/// directories are not followed, matching the rest of the vault traversal.
pub fn write_snapshot(
    app_data: &Path,
    pack_id: &str,
    version: &str,
    pack_dir: &Path,
) -> AppResult<()> {
    let dest = snapshot_root(app_data, pack_id, version);
    let parent = dest
        .parent()
        .ok_or_else(|| crate::error::AppError::msg("Invalid snapshot path"))?;
    crate::vault::ensure_dir(parent)?;
    let staging = parent.join(format!(".{}-staging-{}", version, uuid::Uuid::new_v4()));
    let backup = parent.join(format!(".{}-backup-{}", version, uuid::Uuid::new_v4()));
    crate::vault::ensure_dir(&staging)?;

    let staged = (|| -> AppResult<()> {
        let mut rel_paths = Vec::new();
        list_file_rel_paths(pack_dir, pack_dir, &mut rel_paths)?;
        for rel in rel_paths {
            let target = staging.join(&rel);
            if let Some(parent) = target.parent() {
                crate::vault::ensure_dir(parent)?;
            }
            fs::copy(pack_dir.join(&rel), &target)?;
        }
        Ok(())
    })();
    if let Err(error) = staged {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let had_dest = dest.exists();
    if had_dest {
        fs::rename(&dest, &backup)?;
    }
    if let Err(error) = fs::rename(&staging, &dest) {
        if had_dest {
            let _ = fs::rename(&backup, &dest);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(error.into());
    }
    if had_dest {
        let _ = fs::remove_dir_all(&backup);
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
    pub kind: FileKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    Text,
    Image,
    Binary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DiffPair {
    Text {
        old: Option<String>,
        new: Option<String>,
    },
    Image {
        old: Option<String>,
        new: Option<String>,
    },
    Binary {
        old: Option<BinarySide>,
        new: Option<BinarySide>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct BinarySide {
    pub size: u64,
    pub checksum: String,
}

fn list_file_rel_paths(root: &Path, dir: &Path, out: &mut Vec<String>) -> AppResult<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            list_file_rel_paths(root, &path, out)?;
        } else if path.is_file() {
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

/// The root pack manifest is managed by Nest and should never appear as a
/// user-editable Source Control change. Nested files with the same name are
/// ordinary pack content and remain visible.
fn is_internal_pack_metadata(rel_path: &str) -> bool {
    let normalized = rel_path.replace('\\', "/");
    let mut components = Path::new(&normalized).components();
    matches!(
        (components.next(), components.next()),
        (Some(std::path::Component::Normal(name)), None)
            if name
                .to_string_lossy()
                .eq_ignore_ascii_case("pack.json")
    )
}

fn ensure_source_control_path(rel_path: &str) -> AppResult<()> {
    if is_internal_pack_metadata(rel_path) {
        return Err(AppError::msg(
            "pack.json is managed internally and is not available in Source Control",
        ));
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
    list_file_rel_paths(pack_dir, pack_dir, &mut working)?;
    working.retain(|rel| !is_internal_pack_metadata(rel));

    let has_snapshot = snapshot_dir.is_dir();
    let mut snapshotted = Vec::new();
    if has_snapshot {
        list_file_rel_paths(snapshot_dir, snapshot_dir, &mut snapshotted)?;
        snapshotted.retain(|rel| !is_internal_pack_metadata(rel));
    }

    let mut statuses = Vec::new();
    for rel in &working {
        let snap_path = snapshot_dir.join(rel);
        if !has_snapshot || !snap_path.is_file() {
            statuses.push(FileStatus {
                path: rel.clone(),
                status: FileChangeStatus::New,
                kind: file_kind(pack_dir.join(rel).as_path()),
            });
            continue;
        }
        let working_bytes = fs::read(pack_dir.join(rel))?;
        let snap_bytes = fs::read(&snap_path)?;
        if working_bytes != snap_bytes {
            statuses.push(FileStatus {
                path: rel.clone(),
                status: FileChangeStatus::Modified,
                kind: file_kind(pack_dir.join(rel).as_path()),
            });
        }
    }
    for rel in &snapshotted {
        if !working.contains(rel) {
            statuses.push(FileStatus {
                path: rel.clone(),
                status: FileChangeStatus::Deleted,
                kind: file_kind(snapshot_dir.join(rel).as_path()),
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
    ensure_source_control_path(rel_path)?;
    let working_path = crate::vault::resolve_vault_path(pack_dir, rel_path)?;
    let snap_path = snapshot_dir.join(rel_path);
    let kind_path = if working_path.is_file() {
        working_path.as_path()
    } else {
        snap_path.as_path()
    };
    match file_kind(kind_path) {
        FileKind::Text => Ok(DiffPair::Text {
            old: read_text(&snap_path)?,
            new: read_text(&working_path)?,
        }),
        FileKind::Image => Ok(DiffPair::Image {
            old: read_image(&snap_path)?,
            new: read_image(&working_path)?,
        }),
        FileKind::Binary => Ok(DiffPair::Binary {
            old: read_binary_side(&snap_path)?,
            new: read_binary_side(&working_path)?,
        }),
    }
}

/// Revert one working file to its snapshot content (Modified/Deleted case),
/// or delete it if it has no snapshot counterpart (New case) — the caller
/// doesn't need to know which case applies ahead of time.
pub fn discard_file(pack_dir: &Path, snapshot_dir: &Path, rel_path: &str) -> AppResult<()> {
    ensure_source_control_path(rel_path)?;
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

fn file_kind(path: &Path) -> FileKind {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp"
    ) {
        return FileKind::Image;
    }
    if matches!(
        extension.as_str(),
        "md" | "markdown" | "json" | "txt" | "yaml" | "yml" | "toml" | "csv" | "tsv"
    ) {
        return FileKind::Text;
    }
    FileKind::Binary
}

fn read_text(path: &Path) -> AppResult<Option<String>> {
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(fs::read_to_string(path)?))
}

fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

fn read_image(path: &Path) -> AppResult<Option<String>> {
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(path)?;
    Ok(Some(format!(
        "data:{};base64,{}",
        image_mime(path),
        general_purpose::STANDARD.encode(bytes)
    )))
}

fn read_binary_side(path: &Path) -> AppResult<Option<BinarySide>> {
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(path)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hasher);
    Ok(Some(BinarySide {
        size: bytes.len() as u64,
        checksum: format!("{:016x}", hasher.finish()),
    }))
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
    fn write_snapshot_mirrors_all_pack_files() {
        let app_data = scratch("write-app-data");
        let pack_dir = scratch("write-pack-dir");
        crate::vault::ensure_dir(&pack_dir.join("docs")).unwrap();
        fs::write(pack_dir.join("docs/a.md"), "# A").unwrap();
        fs::write(pack_dir.join("pack.json"), "{}").unwrap();

        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();

        let snap = snapshot_root(&app_data, "pack1", "1.0.0");
        assert!(snap.join("docs/a.md").is_file());
        assert!(snap.join("pack.json").exists());
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
        fs::write(pack_dir.join("pack.json"), r#"{"name":"Before"}"#).unwrap();

        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();
        let snap_dir = snapshot_root(&app_data, "pack1", "1.0.0");

        // Mutate the working copy after the snapshot was taken.
        fs::write(pack_dir.join("edit.md"), "changed").unwrap();
        fs::remove_file(pack_dir.join("gone.md")).unwrap();
        fs::write(pack_dir.join("new.md"), "brand new").unwrap();
        fs::write(pack_dir.join("pack.json"), r#"{"name":"After"}"#).unwrap();

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
        fs::write(pack_dir.join("pack.json"), "{}").unwrap();
        let missing_snapshot = scratch("status-no-snapshot-missing");

        let statuses = compute_status(&pack_dir, &missing_snapshot).unwrap();
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].path, "readme.md");
        assert_eq!(statuses[0].status, FileChangeStatus::New);
    }

    #[test]
    fn source_control_hides_only_the_root_pack_manifest() {
        let app_data = scratch("status-internal-metadata-app-data");
        let pack_dir = scratch("status-internal-metadata-pack");
        crate::vault::ensure_dir(&pack_dir.join("docs")).unwrap();
        fs::write(pack_dir.join("pack.json"), "{}").unwrap();
        fs::write(pack_dir.join("docs/pack.json"), "{}").unwrap();
        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();
        let snap_dir = snapshot_root(&app_data, "pack1", "1.0.0");

        fs::remove_file(pack_dir.join("pack.json")).unwrap();
        fs::write(pack_dir.join("docs/pack.json"), r#"{"changed":true}"#).unwrap();

        let statuses = compute_status(&pack_dir, &snap_dir).unwrap();
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].path, "docs/pack.json");
        assert_eq!(statuses[0].status, FileChangeStatus::Modified);
    }

    #[test]
    fn source_control_rejects_direct_manifest_access() {
        let app_data = scratch("internal-metadata-access-app-data");
        let pack_dir = scratch("internal-metadata-access-pack");
        crate::vault::ensure_dir(&pack_dir).unwrap();
        fs::write(pack_dir.join("pack.json"), "{}").unwrap();
        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();
        let snap_dir = snapshot_root(&app_data, "pack1", "1.0.0");

        fs::write(pack_dir.join("pack.json"), r#"{"changed":true}"#).unwrap();
        assert!(read_pair(&pack_dir, &snap_dir, "pack.json").is_err());
        assert!(discard_file(&pack_dir, &snap_dir, "PACK.JSON").is_err());
        assert_eq!(
            fs::read_to_string(pack_dir.join("pack.json")).unwrap(),
            r#"{"changed":true}"#
        );
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
        assert!(matches!(
            modified,
            DiffPair::Text {
                old: Some(ref old),
                new: Some(ref new)
            } if old == "old content" && new == "new content"
        ));

        let new_file = read_pair(&pack_dir, &snap_dir, "b.md").unwrap();
        assert!(matches!(
            new_file,
            DiffPair::Text {
                old: None,
                new: Some(ref new)
            } if new == "brand new file"
        ));
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
        assert_eq!(
            fs::read_to_string(pack_dir.join("a.md")).unwrap(),
            "original"
        );

        discard_file(&pack_dir, &snap_dir, "b.md").unwrap();
        assert!(!pack_dir.join("b.md").exists());
    }

    #[test]
    fn images_and_binary_files_are_tracked_and_restored() {
        let app_data = scratch("asset-app-data");
        let pack_dir = scratch("asset-pack-dir");
        crate::vault::ensure_dir(&pack_dir).unwrap();
        fs::write(pack_dir.join("cover.png"), [1_u8, 2, 3]).unwrap();
        fs::write(pack_dir.join("archive.bin"), [4_u8, 5, 6]).unwrap();
        write_snapshot(&app_data, "pack1", "1.0.0", &pack_dir).unwrap();
        let snap_dir = snapshot_root(&app_data, "pack1", "1.0.0");

        fs::write(pack_dir.join("cover.png"), [9_u8, 8, 7]).unwrap();
        fs::write(pack_dir.join("archive.bin"), [6_u8, 5, 4]).unwrap();
        let statuses = compute_status(&pack_dir, &snap_dir).unwrap();
        assert!(statuses
            .iter()
            .any(|status| status.path == "cover.png" && status.kind == FileKind::Image));
        assert!(statuses
            .iter()
            .any(|status| status.path == "archive.bin" && status.kind == FileKind::Binary));
        assert!(matches!(
            read_pair(&pack_dir, &snap_dir, "cover.png").unwrap(),
            DiffPair::Image {
                old: Some(_),
                new: Some(_)
            }
        ));
        assert!(matches!(
            read_pair(&pack_dir, &snap_dir, "archive.bin").unwrap(),
            DiffPair::Binary {
                old: Some(_),
                new: Some(_)
            }
        ));

        discard_file(&pack_dir, &snap_dir, "archive.bin").unwrap();
        assert_eq!(fs::read(pack_dir.join("archive.bin")).unwrap(), [4, 5, 6]);
    }
}
