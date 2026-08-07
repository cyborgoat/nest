//! Vault file/folder CRUD, drag-and-drop transfer, and Finder/Explorer
//! reveal — the plain filesystem operations under the active vault root,
//! independent of Hub/pack concerns (see `commands::hub` for those).

use crate::db;
use crate::error::{AppError, AppResult};
use crate::indexing;
use crate::state::SharedState;
use crate::vault::{self, TreeNode};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn vault_list_tree(state: State<'_, SharedState>) -> AppResult<Vec<TreeNode>> {
    let vault = state.vault_path();
    vault::list_tree(&vault)
}

#[tauri::command]
pub fn vault_read_file(state: State<'_, SharedState>, path: String) -> AppResult<String> {
    let vault = state.vault_path();
    vault::read_file(&vault, &path)
}

#[tauri::command]
pub fn vault_read_image(state: State<'_, SharedState>, path: String) -> AppResult<String> {
    let vault = state.vault_path();
    vault::read_image_data_url(&vault, &path)
}

#[tauri::command]
pub fn vault_write_file(
    state: State<'_, SharedState>,
    path: String,
    content: String,
) -> AppResult<()> {
    ensure_vault_path_not_review_locked(state.inner(), &path)?;
    let vault = state.vault_path();
    vault::write_file(&vault, &path, &content)?;
    indexing::schedule(state.inner())?;
    Ok(())
}

#[tauri::command]
pub fn vault_create_file(
    state: State<'_, SharedState>,
    path: String,
    initial_content: Option<String>,
) -> AppResult<()> {
    ensure_vault_path_not_review_locked(state.inner(), &path)?;
    let vault = state.vault_path();
    vault::create_file(&vault, &path, initial_content.as_deref().unwrap_or(""))?;
    indexing::schedule(state.inner())?;
    Ok(())
}

#[tauri::command]
pub fn vault_create_folder(state: State<'_, SharedState>, path: String) -> AppResult<()> {
    ensure_vault_path_not_review_locked(state.inner(), &path)?;
    let vault = state.vault_path();
    vault::create_folder(&vault, &path)?;
    Ok(())
}

#[tauri::command]
pub fn vault_delete_file(state: State<'_, SharedState>, path: String) -> AppResult<()> {
    ensure_vault_path_not_review_locked(state.inner(), &path)?;
    let vault = state.vault_path();
    vault::delete_file(&vault, &path)?;
    indexing::schedule(state.inner())?;
    Ok(())
}

#[tauri::command]
pub fn vault_delete_folder(state: State<'_, SharedState>, path: String) -> AppResult<()> {
    ensure_vault_path_not_review_locked(state.inner(), &path)?;
    let vault = state.vault_path();
    vault::delete_folder(&vault, &path)?;
    indexing::schedule(state.inner())?;
    Ok(())
}

#[tauri::command]
pub fn vault_rename_entry(
    state: State<'_, SharedState>,
    from: String,
    to: String,
) -> AppResult<()> {
    ensure_vault_path_not_review_locked(state.inner(), &from)?;
    ensure_vault_path_not_review_locked(state.inner(), &to)?;
    let vault = state.vault_path();
    vault::rename_entry(&vault, &from, &to)?;
    indexing::schedule(state.inner())?;
    Ok(())
}

#[tauri::command]
pub fn vault_reveal_in_folder(
    app: AppHandle,
    state: State<'_, SharedState>,
    path: String,
) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let vault = state.vault_path();
    let absolute = vault::absolute_path(&vault, &path)?;
    app.opener()
        .reveal_item_in_dir(absolute)
        .map_err(|e| AppError::msg(format!("Could not reveal in folder: {e}")))
}

#[tauri::command]
pub fn vault_open_folder(app: AppHandle, state: State<'_, SharedState>) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let vault = state.vault_path();
    app.opener()
        .open_path(vault.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| AppError::msg(format!("Could not open vault folder: {e}")))
}

#[tauri::command]
pub fn vault_import_files(
    state: State<'_, SharedState>,
    dest_dir: String,
    source_paths: Vec<String>,
) -> AppResult<vault::ImportFilesResult> {
    ensure_vault_path_not_review_locked(state.inner(), &dest_dir)?;
    let vault = state.vault_path();
    let paths: Vec<PathBuf> = source_paths.into_iter().map(PathBuf::from).collect();
    let result = vault::import_files(&vault, &dest_dir, &paths)?;
    if result.imported.iter().any(vault::is_markdown_path) {
        indexing::schedule(state.inner())?;
    }
    Ok(result)
}

#[tauri::command]
pub fn vault_preview_transfer(
    state: State<'_, SharedState>,
    dest_dir: String,
    source_paths: Vec<String>,
    operation: vault::TransferOperation,
) -> AppResult<vault::TransferPreview> {
    ensure_vault_path_not_review_locked(state.inner(), &dest_dir)?;
    if operation == vault::TransferOperation::Move {
        for path in &source_paths {
            ensure_vault_path_not_review_locked(state.inner(), path)?;
        }
    }
    let vault = state.vault_path();
    let paths = source_paths
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    vault::preview_transfer(&vault, &dest_dir, &paths, operation)
}

#[tauri::command]
pub fn vault_apply_transfer(
    state: State<'_, SharedState>,
    dest_dir: String,
    source_paths: Vec<String>,
    operation: vault::TransferOperation,
    conflict_policy: vault::ConflictPolicy,
) -> AppResult<vault::TransferResult> {
    ensure_vault_path_not_review_locked(state.inner(), &dest_dir)?;
    if operation == vault::TransferOperation::Move {
        for path in &source_paths {
            ensure_vault_path_not_review_locked(state.inner(), path)?;
        }
    }
    let vault = state.vault_path();
    let paths = source_paths
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let result = vault::apply_transfer(&vault, &dest_dir, &paths, operation, conflict_policy)?;
    if !result.written_files.is_empty() || !result.removed_paths.is_empty() {
        indexing::schedule(state.inner())?;
    }
    Ok(result)
}

fn ensure_vault_path_not_review_locked(state: &SharedState, path: &str) -> AppResult<()> {
    let conn = state.db.lock();
    let candidate = Path::new(path);
    if let Some(pack) = db::list_sync_state(&conn)?.into_iter().find(|pack| {
        let root = Path::new(&pack.local_path);
        candidate == root || candidate.starts_with(root)
    }) {
        super::ensure_pack_not_review_locked(&pack)?;
    }
    Ok(())
}
