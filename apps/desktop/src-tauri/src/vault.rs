use crate::error::{AppError, AppResult};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
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
    // Clean leftovers from failed removes / accidental path creation.
    prune_empty_dirs(root)?;
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
            // Hide empty folders (e.g. leftovers after a pack remove).
            if children.is_empty() {
                continue;
            }
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

/// Remove empty directories under the vault root (never deletes the root itself).
pub fn prune_empty_dirs(root: &Path) -> AppResult<()> {
    if !root.is_dir() {
        return Ok(());
    }
    prune_empty_dirs_inner(root, root)
}

fn prune_empty_dirs_inner(root: &Path, dir: &Path) -> AppResult<()> {
    let entries: Vec<_> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return Ok(()),
    };
    for entry in &entries {
        let path = entry.path();
        // See `build_tree`: don't follow symlinks into a recursive walk.
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            prune_empty_dirs_inner(root, &path)?;
        }
    }
    // Re-check after children pruned; never remove vault root.
    if dir != root {
        let remaining = fs::read_dir(dir)?
            .filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                !name.starts_with('.')
            })
            .count();
        if remaining == 0 {
            // Remove leftover .DS_Store / hidden junk, then the dir itself.
            if let Ok(rd) = fs::read_dir(dir) {
                for entry in rd.filter_map(|e| e.ok()) {
                    let p = entry.path();
                    if p.is_file() {
                        let _ = fs::remove_file(&p);
                    }
                }
            }
            let _ = fs::remove_dir(dir);
        }
    }
    Ok(())
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

/// Create a new (possibly nested) folder. Note: `list_tree` hides empty
/// folders, so this won't be visible in the tree until it contains a file.
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
        return Err(AppError::msg(format!(
            "{dest_rel} is a file, not a folder"
        )));
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
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
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
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn rejects_traversal() {
        let dir = env::temp_dir().join("nest-vault-test");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir).unwrap();
        assert!(resolve_vault_path(&dir, "../etc/passwd").is_err());
    }

    #[test]
    fn resolve_missing_does_not_create_dirs() {
        let dir = env::temp_dir().join("nest-vault-resolve-no-mkdir");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir).unwrap();
        let resolved = resolve_vault_path(&dir, "gone/pack/note.md").unwrap();
        assert_eq!(resolved, dir.join("gone/pack/note.md"));
        assert!(!dir.join("gone").exists());
    }

    #[cfg(unix)]
    #[test]
    fn list_tree_does_not_follow_a_symlink_cycle() {
        let dir = env::temp_dir().join("nest-vault-symlink-cycle");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir).unwrap();
        fs::write(dir.join("note.md"), b"hello").unwrap();
        // A symlink back to the vault root: `build_tree`/`prune_empty_dirs`
        // must never follow it into recursion, or this call hangs forever.
        std::os::unix::fs::symlink(&dir, dir.join("loop")).unwrap();

        let tree = list_tree(&dir).unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].name, "note.md");
    }

    #[test]
    fn prune_removes_empty_pack_folders() {
        let dir = env::temp_dir().join("nest-vault-prune");
        let _ = fs::remove_dir_all(&dir);
        let empty = dir.join("empty-pack").join("nested");
        ensure_dir(&empty).unwrap();
        prune_empty_dirs(&dir).unwrap();
        assert!(!dir.join("empty-pack").exists());
        assert!(dir.is_dir());
    }

    #[test]
    fn read_image_data_url_encodes_known_image_types() {
        let dir = env::temp_dir().join("nest-vault-image-ok");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir).unwrap();
        fs::write(dir.join("pic.png"), [1, 2, 3, 4]).unwrap();
        let url = read_image_data_url(&dir, "pic.png").unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn read_image_data_url_rejects_non_image_extensions() {
        let dir = env::temp_dir().join("nest-vault-image-bad-ext");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir).unwrap();
        fs::write(dir.join("secret.md"), b"not an image").unwrap();
        assert!(read_image_data_url(&dir, "secret.md").is_err());
    }

    #[test]
    fn read_image_data_url_rejects_traversal() {
        let dir = env::temp_dir().join("nest-vault-image-traversal");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir).unwrap();
        assert!(read_image_data_url(&dir, "../etc/passwd.png").is_err());
    }

    #[test]
    fn list_tree_includes_markdown_and_images_skips_junk() {
        let dir = env::temp_dir().join("nest-vault-list-images");
        let _ = fs::remove_dir_all(&dir);
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
        let dir = env::temp_dir().join("nest-vault-import-files");
        let _ = fs::remove_dir_all(&dir);
        let pack = dir.join("pack");
        ensure_dir(&pack).unwrap();

        let src_dir = env::temp_dir().join("nest-vault-import-src");
        let _ = fs::remove_dir_all(&src_dir);
        ensure_dir(&src_dir).unwrap();
        let src = src_dir.join("photo.png");
        fs::write(&src, [9, 9, 9]).unwrap();

        let first = import_files(&dir, "pack", &[src.clone()]).unwrap();
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
        let dir = env::temp_dir().join("nest-vault-write-file");
        let _ = fs::remove_dir_all(&dir);
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
        let dir = env::temp_dir().join("nest-vault-write-non-md");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir).unwrap();
        assert!(write_file(&dir, "pack/notes.txt", "hi").is_err());
    }

    #[test]
    fn create_file_fails_if_exists() {
        let dir = env::temp_dir().join("nest-vault-create-file-exists");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir.join("pack")).unwrap();
        fs::write(dir.join("pack/a.md"), "# A").unwrap();
        assert!(create_file(&dir, "pack/a.md", "# B").is_err());
        create_file(&dir, "pack/b.md", "# B").unwrap();
        assert_eq!(fs::read_to_string(dir.join("pack/b.md")).unwrap(), "# B");
    }

    #[test]
    fn create_folder_fails_over_existing_file() {
        let dir = env::temp_dir().join("nest-vault-create-folder-conflict");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir.join("pack")).unwrap();
        fs::write(dir.join("pack/x"), "not a dir").unwrap();
        assert!(create_folder(&dir, "pack/x").is_err());
        create_folder(&dir, "pack/subdir").unwrap();
        assert!(dir.join("pack/subdir").is_dir());
    }

    #[test]
    fn delete_file_rejects_directories() {
        let dir = env::temp_dir().join("nest-vault-delete-file-rejects-dir");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir.join("pack/sub")).unwrap();
        assert!(delete_file(&dir, "pack/sub").is_err());
        fs::write(dir.join("pack/a.md"), "# A").unwrap();
        delete_file(&dir, "pack/a.md").unwrap();
        assert!(!dir.join("pack/a.md").exists());
    }

    #[test]
    fn delete_folder_rejects_pack_root() {
        let dir = env::temp_dir().join("nest-vault-delete-folder-pack-root");
        let _ = fs::remove_dir_all(&dir);
        ensure_dir(&dir.join("pack")).unwrap();
        assert!(delete_folder(&dir, "pack").is_err());
        ensure_dir(&dir.join("pack/sub")).unwrap();
        delete_folder(&dir, "pack/sub").unwrap();
        assert!(!dir.join("pack/sub").exists());
    }

    #[test]
    fn rename_entry_rejects_pack_root_and_existing_target() {
        let dir = env::temp_dir().join("nest-vault-rename-entry");
        let _ = fs::remove_dir_all(&dir);
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
    fn copy_dir_recursive_keeps_only_pack_content() {
        let src = env::temp_dir().join("nest-vault-copy-src");
        let dst = env::temp_dir().join("nest-vault-copy-dst");
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
}
