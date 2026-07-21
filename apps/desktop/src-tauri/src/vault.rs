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
    Ok(build_tree(root, root)?)
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

        if path.is_dir() {
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
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
        {
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

fn image_mime_type(path: &Path) -> Option<&'static str> {
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
        if path.is_dir() {
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
    let walker = walkdir::WalkDir::new(src).into_iter().filter_entry(|entry| {
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
