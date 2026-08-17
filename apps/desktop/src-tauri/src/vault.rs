use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Images larger than this are rejected rather than serialized whole over IPC.
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreeNodeKind {
    Folder,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: TreeNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

pub fn ensure_dir(path: &Path) -> AppResult<()> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    Ok(())
}

pub fn vault_root(app_data: &Path) -> PathBuf {
    app_data.join("vault")
}

pub fn list_tree(root: &Path) -> AppResult<Vec<TreeNode>> {
    ensure_dir(root)?;
    build_tree(root, root)
}

fn build_tree(root: &Path, dir: &Path) -> AppResult<Vec<TreeNode>> {
    let mut entries = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .collect::<Vec<_>>();
    entries.sort_by_key(|e| e.file_name());

    let mut nodes = Vec::new();
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");

        // Use the entry's own file type, not `path.is_dir()`: the latter
        // follows symlinks, so a symlinked directory that cycles back to an
        // ancestor would recurse forever. A symlink is never treated as a
        // folder to descend into (matching `walkdir`'s default elsewhere in
        // this codebase); a symlinked `.md` file is still listed below.
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            let children = build_tree(root, &path)?;
            nodes.push(TreeNode {
                name,
                path: rel,
                kind: TreeNodeKind::Folder,
                children: Some(children),
            });
        } else if is_markdown_path(&path) || is_image_path(&path) {
            nodes.push(TreeNode {
                name,
                path: rel,
                kind: TreeNodeKind::File,
                children: None,
            });
        }
    }
    Ok(nodes)
}

pub fn read_file(root: &Path, rel_path: &str) -> AppResult<String> {
    let path = resolve_vault_path(root, rel_path)?;
    if !path.is_file() {
        return Err(AppError::msg(format!(
            "This file is no longer in your library (removed or missing): {rel_path}"
        )));
    }
    Ok(fs::read_to_string(path)?)
}

pub fn image_mime_type(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

pub fn is_image_path(path: impl AsRef<Path>) -> bool {
    image_mime_type(path.as_ref()).is_some()
}

/// Directories skipped while importing a pack (hidden names plus common junk trees).
fn should_skip_pack_entry(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    matches!(
        name,
        "node_modules" | "__pycache__" | "venv" | "dist" | "build" | "target"
    )
}

/// Files Nest keeps when importing a pack folder or zip: markdown, supported
/// images, and pack.json. Everything else is ignored.
pub fn is_pack_content_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name.eq_ignore_ascii_case("pack.json") {
        return true;
    }
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
    {
        return true;
    }
    image_mime_type(path).is_some()
}

/// Read an image from the vault and return it as a `data:` URL, for inline
/// rendering in markdown — never serves files outside the known image types.
pub fn read_image_data_url(root: &Path, rel_path: &str) -> AppResult<String> {
    let path = resolve_vault_path(root, rel_path)?;
    if !path.is_file() {
        return Err(AppError::msg(format!(
            "This image is no longer in your library (removed or missing): {rel_path}"
        )));
    }
    let mime = image_mime_type(&path)
        .ok_or_else(|| AppError::msg(format!("Unsupported image type: {rel_path}")))?;
    let size = fs::metadata(&path)?.len();
    if size > MAX_IMAGE_BYTES {
        return Err(AppError::msg(format!(
            "Image is too large to display ({rel_path})"
        )));
    }
    let bytes = fs::read(&path)?;
    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

/// Resolve a relative vault path and reject path traversal.
/// Does not create directories — callers that write must `ensure_dir` themselves.
pub fn resolve_vault_path(root: &Path, rel_path: &str) -> AppResult<PathBuf> {
    let cleaned = rel_path.trim_start_matches('/');
    if cleaned.is_empty() || cleaned.contains("..") {
        return Err(AppError::msg("Invalid vault path"));
    }
    let path = root.join(cleaned);
    let canonical_root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    if path.exists() {
        let canonical = fs::canonicalize(&path)?;
        if !canonical.starts_with(&canonical_root) {
            return Err(AppError::msg("Path escapes vault"));
        }
        Ok(canonical)
    } else {
        // Missing path: ensure the intended location stays under the vault root
        // without creating folders (creating them left empty packs after deletes).
        let mut probe = root.to_path_buf();
        for component in Path::new(cleaned).components() {
            probe.push(component);
            if probe.exists() {
                let canon = fs::canonicalize(&probe)?;
                if !canon.starts_with(&canonical_root) {
                    return Err(AppError::msg("Path escapes vault"));
                }
            }
        }
        Ok(path)
    }
}

/// Copy pack content from `src` into `dst`, keeping only markdown, supported
/// images, and `pack.json`. Hidden and common build/dependency directories are
/// not descended into.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    ensure_dir(dst)?;
    let walker = walkdir::WalkDir::new(src)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            entry
                .file_name()
                .to_str()
                .map(|name| !should_skip_pack_entry(name))
                .unwrap_or(false)
        });
    for entry in walker {
        let entry = entry.map_err(|e| AppError::msg(e.to_string()))?;
        let path = entry.path();
        if !path.is_file() || !is_pack_content_file(path) {
            continue;
        }
        let rel = path.strip_prefix(src).unwrap_or(path);
        let target = dst.join(rel);
        if let Some(parent) = target.parent() {
            ensure_dir(parent)?;
        }
        fs::copy(path, &target)?;
    }
    Ok(())
}

pub fn is_markdown_path(path: impl AsRef<Path>) -> bool {
    path.as_ref()
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

/// Reject operations targeting a pack root (single path segment) — those go
/// through `remove_pack`/whole-pack flows, which have different bookkeeping.
fn reject_pack_root(rel_path: &str) -> AppResult<()> {
    let cleaned = rel_path.trim_start_matches('/');
    if !cleaned.contains('/') {
        return Err(AppError::msg(
            "Whole knowledge packs must be managed from the pack list, not as a single file or folder",
        ));
    }
    Ok(())
}

/// Overwrite (or create) a markdown file's content.
pub fn write_file(root: &Path, rel_path: &str, content: &str) -> AppResult<()> {
    if !is_markdown_path(rel_path) {
        return Err(AppError::msg("Only markdown (.md) files can be edited"));
    }
    let path = resolve_vault_path(root, rel_path)?;
    if path.is_dir() {
        return Err(AppError::msg(format!("{rel_path} is a folder, not a file")));
    }
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}

/// Create a new markdown file. Fails if a file or folder already exists there.
pub fn create_file(root: &Path, rel_path: &str, initial_content: &str) -> AppResult<()> {
    if !is_markdown_path(rel_path) {
        return Err(AppError::msg("Only markdown (.md) files can be created"));
    }
    let path = resolve_vault_path(root, rel_path)?;
    if path.exists() {
        return Err(AppError::msg(format!("{rel_path} already exists")));
    }
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    fs::write(path, initial_content)?;
    Ok(())
}

/// Create a new (possibly nested) folder. Empty folders are returned by
/// `list_tree`, so they become visible as soon as the tree refreshes.
pub fn create_folder(root: &Path, rel_path: &str) -> AppResult<()> {
    let path = resolve_vault_path(root, rel_path)?;
    if path.is_file() {
        return Err(AppError::msg(format!(
            "{rel_path} already exists as a file"
        )));
    }
    ensure_dir(&path)?;
    Ok(())
}

/// Delete a single markdown file (not a folder — use `delete_folder`).
pub fn delete_file(root: &Path, rel_path: &str) -> AppResult<()> {
    let path = resolve_vault_path(root, rel_path)?;
    if !path.exists() {
        return Err(AppError::msg(format!("{rel_path} does not exist")));
    }
    if path.is_dir() {
        return Err(AppError::msg(format!(
            "{rel_path} is a folder — use delete_folder"
        )));
    }
    fs::remove_file(path)?;
    Ok(())
}

/// Delete a folder and everything under it. Pack roots must go through
/// `remove_pack` instead (different bookkeeping: sync_state purge, etc.).
pub fn delete_folder(root: &Path, rel_path: &str) -> AppResult<()> {
    reject_pack_root(rel_path)?;
    let path = resolve_vault_path(root, rel_path)?;
    if !path.exists() {
        return Err(AppError::msg(format!("{rel_path} does not exist")));
    }
    if !path.is_dir() {
        return Err(AppError::msg(format!(
            "{rel_path} is a file — use delete_file"
        )));
    }
    fs::remove_dir_all(path)?;
    Ok(())
}

/// Rename or move a file/folder within the vault. Pack roots must go through
/// dedicated pack-level flows, not this generic rename.
pub fn rename_entry(root: &Path, from_rel: &str, to_rel: &str) -> AppResult<()> {
    reject_pack_root(from_rel)?;
    reject_pack_root(to_rel)?;
    let from = resolve_vault_path(root, from_rel)?;
    if !from.exists() {
        return Err(AppError::msg(format!("{from_rel} does not exist")));
    }
    let from_rel_path = Path::new(from_rel.trim_matches('/'));
    let to_rel_path = Path::new(to_rel.trim_matches('/'));
    if from.is_dir() && to_rel_path.starts_with(from_rel_path) {
        return Err(AppError::msg("A folder cannot be moved inside itself"));
    }
    let to = resolve_vault_path(root, to_rel)?;
    if to.exists() {
        return Err(AppError::msg(format!("{to_rel} already exists")));
    }
    if let Some(parent) = to.parent() {
        ensure_dir(parent)?;
    }
    rename_or_copy_remove(&from, &to)?;
    Ok(())
}

fn rename_or_copy_remove(from: &Path, to: &Path) -> AppResult<()> {
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::CrossesDevices => {
            if from.is_dir() {
                copy_dir_all(from, to)?;
                fs::remove_dir_all(from)?;
            } else {
                fs::copy(from, to)?;
                fs::remove_file(from)?;
            }
            Ok(())
        }
        Err(err) => Err(err.into()),
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> AppResult<()> {
    ensure_dir(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Absolute filesystem path for a vault-relative entry (for Reveal in Folder).
pub fn absolute_path(root: &Path, rel_path: &str) -> AppResult<PathBuf> {
    let path = resolve_vault_path(root, rel_path)?;
    if !path.exists() {
        return Err(AppError::msg(format!(
            "This file is no longer in your library (removed or missing): {rel_path}"
        )));
    }
    Ok(path)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportFilesResult {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferOperation {
    Copy,
    Move,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    Error,
    Replace,
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransferConflict {
    pub source_path: String,
    pub destination_path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransferPreview {
    pub conflicts: Vec<TransferConflict>,
    pub eligible_count: usize,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TransferResult {
    pub written_files: Vec<String>,
    pub created_folders: Vec<String>,
    pub removed_paths: Vec<String>,
    pub replaced_paths: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone)]
struct TransferRoot {
    source: PathBuf,
    source_label: String,
    destination: PathBuf,
    destination_rel: String,
}

fn normalized_move_sources(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut normalized = paths
        .iter()
        .map(|path| PathBuf::from(path.to_string_lossy().trim_matches('/')))
        .filter(|path| path.components().count() > 1)
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    let mut roots: Vec<PathBuf> = Vec::new();
    for path in normalized {
        if roots.iter().any(|root| path.starts_with(root)) {
            continue;
        }
        roots.push(path);
    }
    roots
}

fn normalized_copy_sources(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut normalized = paths.to_vec();
    normalized.sort();
    normalized.dedup();
    let mut roots: Vec<PathBuf> = Vec::new();
    for path in normalized {
        if roots.iter().any(|root| path.starts_with(root)) {
            continue;
        }
        roots.push(path);
    }
    roots
}

fn transfer_roots(
    root: &Path,
    dest_dir_rel: &str,
    source_paths: &[PathBuf],
    operation: TransferOperation,
) -> AppResult<(Vec<TransferRoot>, Vec<String>)> {
    let dest_rel = dest_dir_rel.trim_matches('/');
    if dest_rel.is_empty() {
        return Err(AppError::msg(
            "Drop items into a knowledge pack folder, not the vault root",
        ));
    }
    let destination_dir = resolve_vault_path(root, dest_rel)?;
    if destination_dir.exists() && !destination_dir.is_dir() {
        return Err(AppError::msg(format!("{dest_rel} is a file, not a folder")));
    }

    let candidates = if operation == TransferOperation::Move {
        normalized_move_sources(source_paths)
    } else {
        normalized_copy_sources(source_paths)
    };
    let mut roots = Vec::new();
    let mut skipped = Vec::new();
    for candidate in candidates {
        let (source, source_label) = if operation == TransferOperation::Move {
            let label = candidate.to_string_lossy().replace('\\', "/");
            (resolve_vault_path(root, &label)?, label)
        } else {
            (candidate.clone(), candidate.to_string_lossy().into_owned())
        };
        let metadata = match fs::symlink_metadata(&source) {
            Ok(metadata) => metadata,
            Err(error) => {
                skipped.push(format!("{source_label}: {error}"));
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            skipped.push(format!("{source_label}: symbolic links are not imported"));
            continue;
        }
        if !metadata.is_file() && !metadata.is_dir() {
            skipped.push(format!("{source_label}: not a file or folder"));
            continue;
        }
        if operation == TransferOperation::Copy
            && metadata.is_file()
            && (!is_pack_content_file(&source)
                || source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.eq_ignore_ascii_case("pack.json"))
                    .unwrap_or(false))
        {
            skipped.push(format!(
                "{source_label}: only markdown and images can be imported"
            ));
            continue;
        }
        let Some(name) = source.file_name().and_then(|name| name.to_str()) else {
            skipped.push(format!("{source_label}: invalid file name"));
            continue;
        };
        if operation == TransferOperation::Copy && metadata.is_dir() && should_skip_pack_entry(name)
        {
            skipped.push(format!("{source_label}: folder is not imported"));
            continue;
        }
        let destination_rel = format!("{dest_rel}/{name}").replace('\\', "/");
        let destination = destination_dir.join(name);
        if operation == TransferOperation::Copy {
            let canonical_source = fs::canonicalize(&source)?;
            let canonical_destination_dir =
                fs::canonicalize(&destination_dir).unwrap_or(destination_dir.clone());
            let canonical_destination = canonical_destination_dir.join(name);
            if canonical_source == canonical_destination {
                skipped.push(format!("{source_label}: already in that folder"));
                continue;
            }
            if metadata.is_dir() && canonical_destination.starts_with(&canonical_source) {
                return Err(AppError::msg("A folder cannot be copied inside itself"));
            }
        }
        if operation == TransferOperation::Move {
            let source_rel = Path::new(&source_label);
            let destination_rel_path = Path::new(&destination_rel);
            if source_rel.parent() == Some(Path::new(dest_rel)) {
                skipped.push(format!("{source_label}: already in that folder"));
                continue;
            }
            if metadata.is_dir() && destination_rel_path.starts_with(source_rel) {
                return Err(AppError::msg("A folder cannot be moved inside itself"));
            }
        }
        roots.push(TransferRoot {
            source,
            source_label,
            destination,
            destination_rel,
        });
    }
    Ok((roots, skipped))
}

fn external_file_allowed(path: &Path) -> bool {
    is_pack_content_file(path)
        && !path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case("pack.json"))
            .unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
fn inspect_transfer_entry(
    source: &Path,
    source_label: &str,
    destination: &Path,
    destination_rel: &str,
    operation: TransferOperation,
    conflicts: &mut Vec<TransferConflict>,
    skipped: &mut Vec<String>,
    incoming: &mut HashMap<String, bool>,
) -> AppResult<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() {
        skipped.push(format!("{source_label}: symbolic links are not imported"));
        return Ok(());
    }
    let source_is_dir = metadata.is_dir();
    if let Some(existing_is_dir) = incoming.get(destination_rel) {
        if !source_is_dir || !existing_is_dir {
            conflicts.push(TransferConflict {
                source_path: source_label.to_string(),
                destination_path: destination_rel.to_string(),
                kind: if !source_is_dir && !existing_is_dir {
                    "file".into()
                } else {
                    "type_mismatch".into()
                },
            });
            return Ok(());
        }
    } else {
        incoming.insert(destination_rel.to_string(), source_is_dir);
    }
    if metadata.is_file() {
        if operation == TransferOperation::Copy && !external_file_allowed(source) {
            skipped.push(format!(
                "{source_label}: only markdown and images can be imported"
            ));
            return Ok(());
        }
        if destination.exists() {
            conflicts.push(TransferConflict {
                source_path: source_label.to_string(),
                destination_path: destination_rel.to_string(),
                kind: if destination.is_file() {
                    "file".into()
                } else {
                    "type_mismatch".into()
                },
            });
        }
        return Ok(());
    }
    if !metadata.is_dir() {
        skipped.push(format!("{source_label}: not a file or folder"));
        return Ok(());
    }
    if destination.exists() && !destination.is_dir() {
        conflicts.push(TransferConflict {
            source_path: source_label.to_string(),
            destination_path: destination_rel.to_string(),
            kind: "type_mismatch".into(),
        });
        return Ok(());
    }
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        let child_label = format!("{source_label}/{}", name.to_string_lossy());
        if operation == TransferOperation::Copy
            && entry.file_type()?.is_dir()
            && should_skip_pack_entry(&name.to_string_lossy())
        {
            skipped.push(format!("{child_label}: folder is not imported"));
            continue;
        }
        let child_rel = format!("{destination_rel}/{}", name.to_string_lossy());
        inspect_transfer_entry(
            &entry.path(),
            &child_label,
            &destination.join(&name),
            &child_rel,
            operation,
            conflicts,
            skipped,
            incoming,
        )?;
    }
    Ok(())
}

pub fn preview_transfer(
    root: &Path,
    dest_dir_rel: &str,
    source_paths: &[PathBuf],
    operation: TransferOperation,
) -> AppResult<TransferPreview> {
    let (roots, mut skipped) = transfer_roots(root, dest_dir_rel, source_paths, operation)?;
    let mut conflicts = Vec::new();
    let mut incoming = HashMap::new();
    for item in &roots {
        inspect_transfer_entry(
            &item.source,
            &item.source_label,
            &item.destination,
            &item.destination_rel,
            operation,
            &mut conflicts,
            &mut skipped,
            &mut incoming,
        )?;
    }
    Ok(TransferPreview {
        conflicts,
        eligible_count: roots.len(),
        skipped,
    })
}

fn remove_existing(path: &Path) -> AppResult<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn apply_transfer_entry(
    source: &Path,
    source_label: &str,
    destination: &Path,
    destination_rel: &str,
    operation: TransferOperation,
    policy: ConflictPolicy,
    result: &mut TransferResult,
    source_is_external: bool,
) -> AppResult<bool> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() {
        result
            .skipped
            .push(format!("{source_label}: symbolic links are not imported"));
        return Ok(false);
    }
    if metadata.is_file() {
        if source_is_external && !external_file_allowed(source) {
            result.skipped.push(format!(
                "{source_label}: only markdown and images can be imported"
            ));
            return Ok(false);
        }
        if destination.exists() {
            match policy {
                ConflictPolicy::Error => {
                    return Err(AppError::msg(format!(
                        "{destination_rel} already exists; review conflicts and try again"
                    )))
                }
                ConflictPolicy::Skip => {
                    result.skipped.push(format!("{destination_rel}: conflict"));
                    return Ok(false);
                }
                ConflictPolicy::Replace => {
                    remove_existing(destination)?;
                    result.replaced_paths.push(destination_rel.to_string());
                }
            }
        }
        if let Some(parent) = destination.parent() {
            ensure_dir(parent)?;
        }
        if operation == TransferOperation::Move {
            rename_or_copy_remove(source, destination)?;
            result.removed_paths.push(source_label.to_string());
        } else {
            fs::copy(source, destination)?;
        }
        result.written_files.push(destination_rel.to_string());
        return Ok(true);
    }
    if !metadata.is_dir() {
        result
            .skipped
            .push(format!("{source_label}: not a file or folder"));
        return Ok(false);
    }
    let destination_was_directory = destination.is_dir();
    if destination.exists() && !destination.is_dir() {
        match policy {
            ConflictPolicy::Error => {
                return Err(AppError::msg(format!(
                    "{destination_rel} already exists; review conflicts and try again"
                )))
            }
            ConflictPolicy::Skip => {
                result.skipped.push(format!("{destination_rel}: conflict"));
                return Ok(false);
            }
            ConflictPolicy::Replace => {
                remove_existing(destination)?;
                result.replaced_paths.push(destination_rel.to_string());
            }
        }
    }
    ensure_dir(destination)?;
    if !destination_was_directory {
        result.created_folders.push(destination_rel.to_string());
    }
    let mut fully_moved = true;
    let entries = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
    for entry in entries {
        let name = entry.file_name();
        let child_label = format!("{source_label}/{}", name.to_string_lossy());
        if source_is_external
            && entry.file_type()?.is_dir()
            && should_skip_pack_entry(&name.to_string_lossy())
        {
            result
                .skipped
                .push(format!("{child_label}: folder is not imported"));
            continue;
        }
        let child_rel = format!("{destination_rel}/{}", name.to_string_lossy());
        if !apply_transfer_entry(
            &entry.path(),
            &child_label,
            &destination.join(&name),
            &child_rel,
            operation,
            policy,
            result,
            source_is_external,
        )? {
            fully_moved = false;
        }
    }
    if operation == TransferOperation::Move && fully_moved {
        fs::remove_dir(source)?;
        result.removed_paths.push(source_label.to_string());
    }
    Ok(fully_moved)
}

pub fn apply_transfer(
    root: &Path,
    dest_dir_rel: &str,
    source_paths: &[PathBuf],
    operation: TransferOperation,
    policy: ConflictPolicy,
) -> AppResult<TransferResult> {
    if policy == ConflictPolicy::Error {
        let preview = preview_transfer(root, dest_dir_rel, source_paths, operation)?;
        if !preview.conflicts.is_empty() {
            return Err(AppError::msg("File conflicts require confirmation"));
        }
    }
    let (roots, skipped) = transfer_roots(root, dest_dir_rel, source_paths, operation)?;
    let mut result = TransferResult {
        skipped,
        ..TransferResult::default()
    };
    for item in roots {
        apply_transfer_entry(
            &item.source,
            &item.source_label,
            &item.destination,
            &item.destination_rel,
            operation,
            policy,
            &mut result,
            operation == TransferOperation::Copy,
        )?;
    }
    Ok(result)
}

/// Copy external markdown/image files into a vault folder.
pub fn import_files(
    root: &Path,
    dest_dir_rel: &str,
    source_paths: &[PathBuf],
) -> AppResult<ImportFilesResult> {
    let dest_rel = dest_dir_rel.trim_start_matches('/').trim_end_matches('/');
    if dest_rel.is_empty() {
        return Err(AppError::msg(
            "Drop files into a knowledge pack folder, not the vault root",
        ));
    }
    let dest = resolve_vault_path(root, dest_rel)?;
    if dest.exists() && !dest.is_dir() {
        return Err(AppError::msg(format!("{dest_rel} is a file, not a folder")));
    }
    ensure_dir(&dest)?;

    let mut imported = Vec::new();
    let mut skipped = Vec::new();

    for source in source_paths {
        if !source.is_file() {
            let name = source
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("item");
            skipped.push(format!("{name}: not a file"));
            continue;
        }
        if !is_pack_content_file(source)
            || source
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.eq_ignore_ascii_case("pack.json"))
                .unwrap_or(false)
        {
            let name = source
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file");
            skipped.push(format!("{name}: only markdown and images can be imported"));
            continue;
        }

        let Some(file_name) = source.file_name().and_then(|n| n.to_str()) else {
            skipped.push("invalid file name".into());
            continue;
        };

        let unique_name = unique_file_name(&dest, file_name);
        let target = dest.join(&unique_name);
        match fs::copy(source, &target) {
            Ok(_) => {
                let rel = format!("{dest_rel}/{unique_name}").replace('\\', "/");
                imported.push(rel);
            }
            Err(e) => skipped.push(format!("{file_name}: {e}")),
        }
    }

    if imported.is_empty() && !skipped.is_empty() {
        return Err(AppError::msg(skipped.join("; ")));
    }
    Ok(ImportFilesResult { imported, skipped })
}

fn unique_file_name(dir: &Path, file_name: &str) -> String {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return file_name.to_string();
    }
    let path = Path::new(file_name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    for i in 1..10_000 {
        let name = format!("{stem}-{i}{ext}");
        if !dir.join(&name).exists() {
            return name;
        }
    }
    format!("{stem}-copy{ext}")
}

/// Delete an entire top-level knowledge pack from the vault.
/// Only pack roots are allowed (single path segment, directory).
pub fn remove_pack(root: &Path, rel_path: &str) -> AppResult<()> {
    let cleaned = rel_path.trim_start_matches('/');
    if cleaned.is_empty() {
        return Err(AppError::msg("Cannot remove vault root"));
    }
    if cleaned.contains('/') || cleaned.contains('\\') {
        return Err(AppError::msg(
            "Only entire knowledge packs can be removed, not individual files or folders",
        ));
    }
    let path = resolve_vault_path(root, cleaned)?;
    if !path.exists() {
        return Err(AppError::msg(format!("Pack not found: {cleaned}")));
    }
    if !path.is_dir() {
        return Err(AppError::msg(
            "Only entire knowledge packs can be removed, not individual files",
        ));
    }
    fs::remove_dir_all(&path)?;
    Ok(())
}


#[cfg(test)]
pub(crate) fn test_temp_dir(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!("nest-{label}-{}", uuid::Uuid::new_v4()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        let dir = test_temp_dir("vault-test");
        ensure_dir(&dir).unwrap();
        assert!(resolve_vault_path(&dir, "../etc/passwd").is_err());
    }

    #[test]
    fn resolve_missing_does_not_create_dirs() {
        let dir = test_temp_dir("vault-resolve-no-mkdir");
        ensure_dir(&dir).unwrap();
        let resolved = resolve_vault_path(&dir, "gone/pack/note.md").unwrap();
        assert_eq!(resolved, dir.join("gone/pack/note.md"));
        assert!(!dir.join("gone").exists());
    }

    #[cfg(unix)]
    #[test]
    fn list_tree_does_not_follow_a_symlink_cycle() {
        let dir = test_temp_dir("vault-symlink-cycle");
        ensure_dir(&dir).unwrap();
        fs::write(dir.join("note.md"), b"hello").unwrap();
        // A symlink back to the vault root: `build_tree` must never follow it
        // into recursion, or this call hangs forever.
        std::os::unix::fs::symlink(&dir, dir.join("loop")).unwrap();

        let tree = list_tree(&dir).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "note.md");
    }

    #[test]
    fn list_tree_preserves_and_includes_empty_folders() {
        let dir = test_temp_dir("vault-list-empty-folders");
        let empty = dir.join("demo-pack").join("notes").join("drafts");
        ensure_dir(&empty).unwrap();

        let tree = list_tree(&dir).unwrap();

        assert!(empty.is_dir());
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "demo-pack");
        let notes = &tree[0].children.as_ref().unwrap()[0];
        assert_eq!(notes.name, "notes");
        let drafts = &notes.children.as_ref().unwrap()[0];
        assert_eq!(drafts.name, "drafts");
        assert!(drafts.children.as_ref().unwrap().is_empty());
    }

    #[test]
    fn read_image_data_url_encodes_known_image_types() {
        let dir = test_temp_dir("vault-image-ok");
        ensure_dir(&dir).unwrap();
        fs::write(dir.join("pic.png"), [1, 2, 3, 4]).unwrap();
        let url = read_image_data_url(&dir, "pic.png").unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn read_image_data_url_rejects_non_image_extensions() {
        let dir = test_temp_dir("vault-image-bad-ext");
        ensure_dir(&dir).unwrap();
        fs::write(dir.join("secret.md"), b"not an image").unwrap();
        assert!(read_image_data_url(&dir, "secret.md").is_err());
    }

    #[test]
    fn read_image_data_url_rejects_traversal() {
        let dir = test_temp_dir("vault-image-traversal");
        ensure_dir(&dir).unwrap();
        assert!(read_image_data_url(&dir, "../etc/passwd.png").is_err());
    }

    #[test]
    fn list_tree_includes_markdown_and_images_skips_junk() {
        let dir = test_temp_dir("vault-list-images");
        let pack = dir.join("demo-pack");
        ensure_dir(&pack.join("assets")).unwrap();
        fs::write(pack.join("readme.md"), b"# hi").unwrap();
        fs::write(pack.join("assets/pic.png"), [1, 2, 3]).unwrap();
        fs::write(pack.join("pack.json"), b"{}").unwrap();
        fs::write(pack.join("notes.txt"), b"nope").unwrap();
        fs::write(pack.join("assets/data.csv"), b"a,b").unwrap();

        let tree = list_tree(&dir).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "demo-pack");
        let children = tree[0].children.as_ref().unwrap();
        let names: Vec<_> = children.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"readme.md"));
        assert!(names.contains(&"assets"));
        assert!(!names.contains(&"pack.json"));
        assert!(!names.contains(&"notes.txt"));

        let assets = children.iter().find(|n| n.name == "assets").unwrap();
        let asset_names: Vec<_> = assets
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|n| n.name.as_str())
            .collect();
        assert_eq!(asset_names, vec!["pic.png"]);
    }

    #[test]
    fn import_files_copies_images_with_unique_names() {
        let dir = test_temp_dir("vault-import-files");
        let pack = dir.join("pack");
        ensure_dir(&pack).unwrap();

        let src_dir = test_temp_dir("vault-import-src");
        ensure_dir(&src_dir).unwrap();
        let src = src_dir.join("photo.png");
        fs::write(&src, [9, 9, 9]).unwrap();

        let first = import_files(&dir, "pack", std::slice::from_ref(&src)).unwrap();
        assert_eq!(first.imported, vec!["pack/photo.png"]);
        assert!(first.skipped.is_empty());

        let second = import_files(&dir, "pack", &[src]).unwrap();
        assert_eq!(second.imported, vec!["pack/photo-1.png"]);
        assert!(dir.join("pack/photo.png").is_file());
        assert!(dir.join("pack/photo-1.png").is_file());
    }

    #[test]
    fn is_pack_content_file_allows_markdown_images_and_meta() {
        assert!(is_pack_content_file(Path::new("notes/guide.md")));
        assert!(is_pack_content_file(Path::new("pack.json")));
        assert!(is_pack_content_file(Path::new("images/pic.PNG")));
        assert!(is_pack_content_file(Path::new("diagram.svg")));
        assert!(!is_pack_content_file(Path::new("data.csv")));
        assert!(!is_pack_content_file(Path::new("video.mp4")));
        assert!(!is_pack_content_file(Path::new("readme.txt")));
    }

    #[test]
    fn write_file_creates_and_overwrites_markdown() {
        let dir = test_temp_dir("vault-write-file");
        ensure_dir(&dir).unwrap();
        write_file(&dir, "pack/notes.md", "# Hello").unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("pack/notes.md")).unwrap(),
            "# Hello"
        );
        write_file(&dir, "pack/notes.md", "# Updated").unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("pack/notes.md")).unwrap(),
            "# Updated"
        );
    }

    #[test]
    fn write_file_rejects_non_markdown() {
        let dir = test_temp_dir("vault-write-non-md");
        ensure_dir(&dir).unwrap();
        assert!(write_file(&dir, "pack/notes.txt", "hi").is_err());
    }

    #[test]
    fn create_file_fails_if_exists() {
        let dir = test_temp_dir("vault-create-file-exists");
        ensure_dir(&dir.join("pack")).unwrap();
        fs::write(dir.join("pack/a.md"), "# A").unwrap();
        assert!(create_file(&dir, "pack/a.md", "# B").is_err());
        create_file(&dir, "pack/b.md", "# B").unwrap();
        assert_eq!(fs::read_to_string(dir.join("pack/b.md")).unwrap(), "# B");
    }

    #[test]
    fn create_folder_fails_over_existing_file() {
        let dir = test_temp_dir("vault-create-folder-conflict");
        ensure_dir(&dir.join("pack")).unwrap();
        fs::write(dir.join("pack/x"), "not a dir").unwrap();
        assert!(create_folder(&dir, "pack/x").is_err());
        create_folder(&dir, "pack/subdir").unwrap();
        assert!(dir.join("pack/subdir").is_dir());
    }

    #[test]
    fn delete_file_rejects_directories() {
        let dir = test_temp_dir("vault-delete-file-rejects-dir");
        ensure_dir(&dir.join("pack/sub")).unwrap();
        assert!(delete_file(&dir, "pack/sub").is_err());
        fs::write(dir.join("pack/a.md"), "# A").unwrap();
        delete_file(&dir, "pack/a.md").unwrap();
        assert!(!dir.join("pack/a.md").exists());
    }

    #[test]
    fn delete_folder_rejects_pack_root() {
        let dir = test_temp_dir("vault-delete-folder-pack-root");
        ensure_dir(&dir.join("pack")).unwrap();
        assert!(delete_folder(&dir, "pack").is_err());
        ensure_dir(&dir.join("pack/sub")).unwrap();
        delete_folder(&dir, "pack/sub").unwrap();
        assert!(!dir.join("pack/sub").exists());
    }

    #[test]
    fn rename_entry_rejects_pack_root_and_existing_target() {
        let dir = test_temp_dir("vault-rename-entry");
        ensure_dir(&dir.join("pack")).unwrap();
        assert!(rename_entry(&dir, "pack", "other").is_err());
        fs::write(dir.join("pack/a.md"), "# A").unwrap();
        fs::write(dir.join("pack/b.md"), "# B").unwrap();
        assert!(rename_entry(&dir, "pack/a.md", "pack/b.md").is_err());
        rename_entry(&dir, "pack/a.md", "pack/c.md").unwrap();
        assert!(!dir.join("pack/a.md").exists());
        assert_eq!(fs::read_to_string(dir.join("pack/c.md")).unwrap(), "# A");
    }

    #[test]
    fn rename_entry_moves_files_and_folders_between_packs() {
        let dir = test_temp_dir("vault-move-between-packs");
        ensure_dir(&dir.join("source/docs/nested")).unwrap();
        ensure_dir(&dir.join("destination")).unwrap();
        fs::write(dir.join("source/note.md"), "# Note").unwrap();
        fs::write(dir.join("source/docs/nested/guide.md"), "# Guide").unwrap();

        rename_entry(&dir, "source/note.md", "destination/note.md").unwrap();
        rename_entry(&dir, "source/docs", "destination/docs").unwrap();

        assert!(!dir.join("source/note.md").exists());
        assert!(!dir.join("source/docs").exists());
        assert_eq!(
            fs::read_to_string(dir.join("destination/note.md")).unwrap(),
            "# Note"
        );
        assert_eq!(
            fs::read_to_string(dir.join("destination/docs/nested/guide.md")).unwrap(),
            "# Guide"
        );
    }

    #[test]
    fn rename_entry_rejects_folder_descendant_without_creating_directories() {
        let dir = test_temp_dir("vault-move-folder-descendant");
        ensure_dir(&dir.join("pack/docs")).unwrap();
        fs::write(dir.join("pack/docs/note.md"), "# Note").unwrap();

        assert!(rename_entry(&dir, "pack/docs", "pack/docs/nested/docs").is_err());
        assert!(dir.join("pack/docs/note.md").is_file());
        assert!(!dir.join("pack/docs/nested").exists());
    }

    #[test]
    fn copy_dir_recursive_keeps_only_pack_content() {
        let src = test_temp_dir("vault-copy-src");
        let dst = test_temp_dir("vault-copy-dst");
        let _ = fs::remove_dir_all(&src);
        let _ = fs::remove_dir_all(&dst);
        ensure_dir(&src.join("docs")).unwrap();
        ensure_dir(&src.join("images")).unwrap();
        ensure_dir(&src.join("node_modules/pkg")).unwrap();
        ensure_dir(&src.join(".git")).unwrap();
        fs::write(src.join("docs/a.md"), b"# A").unwrap();
        fs::write(src.join("images/pic.png"), [1, 2, 3]).unwrap();
        fs::write(src.join("pack.json"), b"{}").unwrap();
        fs::write(src.join("docs/notes.pdf"), b"%PDF").unwrap();
        fs::write(src.join("node_modules/pkg/index.js"), b"module.exports=1").unwrap();
        fs::write(src.join(".git/config"), b"hidden").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert!(dst.join("docs/a.md").is_file());
        assert!(dst.join("images/pic.png").is_file());
        assert!(dst.join("pack.json").is_file());
        assert!(!dst.join("docs/notes.pdf").exists());
        assert!(!dst.join("node_modules").exists());
        assert!(!dst.join(".git").exists());
    }

    #[test]
    fn external_folder_transfer_previews_and_skips_conflicting_files() {
        let vault = test_temp_dir("vault-transfer-copy");
        let source = test_temp_dir("vault-transfer-copy-source");
        let _ = fs::remove_dir_all(&vault);
        let _ = fs::remove_dir_all(&source);
        ensure_dir(&vault.join("pack/docs")).unwrap();
        ensure_dir(&source.join("docs")).unwrap();
        fs::write(vault.join("pack/docs/note.md"), "destination").unwrap();
        fs::write(source.join("docs/note.md"), "incoming").unwrap();
        fs::write(source.join("docs/new.md"), "new").unwrap();
        fs::write(source.join("docs/ignored.txt"), "ignored").unwrap();

        let preview = preview_transfer(
            &vault,
            "pack",
            &[source.join("docs")],
            TransferOperation::Copy,
        )
        .unwrap();
        assert_eq!(preview.eligible_count, 1);
        assert_eq!(preview.conflicts.len(), 1);
        assert!(preview.skipped[0].contains("ignored.txt"));

        let result = apply_transfer(
            &vault,
            "pack",
            &[source.join("docs")],
            TransferOperation::Copy,
            ConflictPolicy::Skip,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(vault.join("pack/docs/note.md")).unwrap(),
            "destination"
        );
        assert_eq!(
            fs::read_to_string(vault.join("pack/docs/new.md")).unwrap(),
            "new"
        );
        assert!(!vault.join("pack/docs/ignored.txt").exists());
        assert!(result.written_files.contains(&"pack/docs/new.md".into()));
    }

    #[test]
    fn external_transfer_replaces_a_destination_type_mismatch() {
        let vault = test_temp_dir("vault-transfer-replace");
        let source = test_temp_dir("vault-transfer-replace-source");
        let _ = fs::remove_dir_all(&vault);
        let _ = fs::remove_dir_all(&source);
        ensure_dir(&vault.join("pack/note.md")).unwrap();
        ensure_dir(&source).unwrap();
        fs::write(source.join("note.md"), "incoming").unwrap();

        let result = apply_transfer(
            &vault,
            "pack",
            &[source.join("note.md")],
            TransferOperation::Copy,
            ConflictPolicy::Replace,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(vault.join("pack/note.md")).unwrap(),
            "incoming"
        );
        assert_eq!(result.replaced_paths, vec!["pack/note.md"]);
    }

    #[test]
    fn internal_batch_move_merges_folders_and_keeps_skipped_sources() {
        let vault = test_temp_dir("vault-transfer-move");
        ensure_dir(&vault.join("source/docs")).unwrap();
        ensure_dir(&vault.join("destination/docs")).unwrap();
        fs::write(vault.join("source/docs/conflict.md"), "source").unwrap();
        fs::write(vault.join("source/docs/moved.md"), "moved").unwrap();
        fs::write(vault.join("destination/docs/conflict.md"), "destination").unwrap();

        let sources = vec![
            PathBuf::from("source/docs"),
            PathBuf::from("source/docs/moved.md"),
        ];
        let preview =
            preview_transfer(&vault, "destination", &sources, TransferOperation::Move).unwrap();
        assert_eq!(preview.eligible_count, 1);
        assert_eq!(preview.conflicts.len(), 1);

        let result = apply_transfer(
            &vault,
            "destination",
            &sources,
            TransferOperation::Move,
            ConflictPolicy::Skip,
        )
        .unwrap();
        assert!(vault.join("source/docs/conflict.md").is_file());
        assert!(!vault.join("source/docs/moved.md").exists());
        assert!(vault.join("destination/docs/moved.md").is_file());
        assert_eq!(
            fs::read_to_string(vault.join("destination/docs/conflict.md")).unwrap(),
            "destination"
        );
        assert!(result
            .removed_paths
            .contains(&"source/docs/moved.md".into()));
    }

    #[test]
    fn transfer_preserves_empty_external_folders() {
        let vault = test_temp_dir("vault-transfer-empty");
        let source = test_temp_dir("vault-transfer-empty-source");
        let _ = fs::remove_dir_all(&vault);
        let _ = fs::remove_dir_all(&source);
        ensure_dir(&vault.join("pack")).unwrap();
        ensure_dir(&source.join("empty")).unwrap();
        apply_transfer(
            &vault,
            "pack",
            &[source.join("empty")],
            TransferOperation::Copy,
            ConflictPolicy::Error,
        )
        .unwrap();
        assert!(vault.join("pack/empty").is_dir());
    }

    #[test]
    fn transfer_preview_detects_conflicts_within_the_incoming_batch() {
        let vault = test_temp_dir("vault-transfer-batch-conflict");
        let first = test_temp_dir("vault-transfer-batch-first");
        let second = test_temp_dir("vault-transfer-batch-second");
        let _ = fs::remove_dir_all(&vault);
        let _ = fs::remove_dir_all(&first);
        let _ = fs::remove_dir_all(&second);
        ensure_dir(&vault.join("pack")).unwrap();
        ensure_dir(&first).unwrap();
        ensure_dir(&second).unwrap();
        fs::write(first.join("same.md"), "first").unwrap();
        fs::write(second.join("same.md"), "second").unwrap();

        let preview = preview_transfer(
            &vault,
            "pack",
            &[first.join("same.md"), second.join("same.md")],
            TransferOperation::Copy,
        )
        .unwrap();
        assert_eq!(preview.conflicts.len(), 1);
        assert_eq!(preview.conflicts[0].destination_path, "pack/same.md");
        assert!(!vault.join("pack/same.md").exists());

        assert!(apply_transfer(
            &vault,
            "pack",
            &[first.join("same.md"), second.join("same.md")],
            TransferOperation::Copy,
            ConflictPolicy::Error,
        )
        .is_err());
        assert!(!vault.join("pack/same.md").exists());
    }

    #[test]
    fn external_transfer_skips_self_copies_and_normalizes_nested_sources() {
        let vault = test_temp_dir("vault-transfer-self-copy");
        ensure_dir(&vault.join("pack/docs")).unwrap();
        fs::write(vault.join("pack/docs/note.md"), "keep").unwrap();

        let self_preview = preview_transfer(
            &vault,
            "pack/docs",
            &[vault.join("pack/docs/note.md")],
            TransferOperation::Copy,
        )
        .unwrap();
        assert_eq!(self_preview.eligible_count, 0);
        assert!(self_preview.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(vault.join("pack/docs/note.md")).unwrap(),
            "keep"
        );

        ensure_dir(&vault.join("other")).unwrap();
        let nested_preview = preview_transfer(
            &vault,
            "other",
            &[vault.join("pack/docs"), vault.join("pack/docs/note.md")],
            TransferOperation::Copy,
        )
        .unwrap();
        assert_eq!(nested_preview.eligible_count, 1);
    }
}
