use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

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
            nodes.push(TreeNode {
                name,
                path: rel,
                kind: TreeNodeKind::Folder,
                children: Some(build_tree(root, &path)?),
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
        return Err(AppError::msg(format!("File not found: {rel_path}")));
    }
    Ok(fs::read_to_string(path)?)
}

/// Resolve a relative vault path and reject path traversal.
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
        // For new paths (e.g. download destination), check parent stays in root.
        if let Some(parent) = path.parent() {
            ensure_dir(parent)?;
            let parent_canon = fs::canonicalize(parent)?;
            if !parent_canon.starts_with(&canonical_root) {
                return Err(AppError::msg("Path escapes vault"));
            }
        }
        Ok(path)
    }
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    ensure_dir(dst)?;
    for entry in walkdir::WalkDir::new(src) {
        let entry = entry.map_err(|e| AppError::msg(e.to_string()))?;
        let path = entry.path();
        let rel = path.strip_prefix(src).unwrap_or(path);
        let target = dst.join(rel);
        if path.is_dir() {
            ensure_dir(&target)?;
        } else if path.is_file() {
            if let Some(parent) = target.parent() {
                ensure_dir(parent)?;
            }
            fs::copy(path, &target)?;
        }
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
}
