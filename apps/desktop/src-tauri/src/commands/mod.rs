//! Tauri command surface, split by domain. Each submodule owns its own
//! `#[tauri::command]` functions and domain-private helpers; this file only
//! holds what's genuinely shared across more than one domain, plus the
//! re-exports that let `lib.rs`'s `generate_handler![commands::vault_list_tree, ...]`
//! list keep working unchanged regardless of which submodule a command
//! actually lives in.

mod chat;
mod claude;
mod health;
mod hub;
mod index;
mod settings;
mod vault;

pub use chat::*;
pub use claude::*;
pub use health::*;
pub use hub::*;
pub use index::*;
pub use settings::*;
pub use vault::*;

use crate::db::InstalledPack;
use crate::error::{AppError, AppResult};
use std::fs;
use std::path::Path;

/// A pack under an in-progress publish review can't be edited or discarded
/// — its submitted content is what's being reviewed, so mutating it locally
/// would invalidate the review. Shared by vault path writes (via
/// `vault::ensure_vault_path_not_review_locked`) and hub's own pack
/// mutations, since both need to enforce the same rule.
pub(crate) fn ensure_pack_not_review_locked(pack: &InstalledPack) -> AppResult<()> {
    if pack.publish_review_status.as_deref() == Some("pending") {
        return Err(AppError::msg(format!(
            "{} is locked while its publish request is under review. Cancel the request to edit it again.",
            pack.name
        )));
    }
    Ok(())
}

/// Recursively copy `source` into `destination`, rejecting symlinks. Shared
/// by settings' knowledge-directory migration and hub's approved-merge
/// snapshot backup, since both need an exact, symlink-safe directory copy.
pub(crate) fn copy_directory_exact(source: &Path, destination: &Path) -> AppResult<()> {
    fs::create_dir_all(destination)?;
    for entry in walkdir::WalkDir::new(source) {
        let entry = entry.map_err(|error| AppError::msg(error.to_string()))?;
        let path = entry.path();
        if path == source {
            continue;
        }
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::msg(format!(
                "Cannot migrate a knowledge pack containing a symbolic link: {}",
                path.display()
            )));
        }
        let relative = path
            .strip_prefix(source)
            .map_err(|error| AppError::msg(error.to_string()))?;
        let target = destination.join(relative);
        if metadata.is_dir() {
            fs::create_dir_all(&target)?;
        } else if metadata.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(path, &target)?;
        }
    }
    Ok(())
}
