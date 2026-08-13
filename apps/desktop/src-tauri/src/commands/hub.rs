//! Hub-registry commands: pack browsing/install, source-control-style
//! status/diff/discard against the pack snapshot baseline, auth, publish
//! workflow, and Hub message inbox. The single largest domain (this file
//! is still large — a further split into per-sub-area files is a
//! reasonable next step, not attempted in this pass).

use super::{copy_directory_exact, ensure_pack_not_review_locked};
use crate::db::{self, AppSettings, InstalledPack, PackMeta};
use crate::error::{AppError, AppResult};
use crate::hub::{self, PackProject};
use crate::indexing;
use crate::state::SharedState;
use crate::vault;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::path::{Component, Path};
use tauri::State;

/// Look up an installed pack by id, or fail with a consistent error message.
/// Shared by every command that needs "the pack, or a clear error" before
/// doing anything else.
fn require_installed_pack(conn: &rusqlite::Connection, pack_id: &str) -> AppResult<InstalledPack> {
    let pack_id = pack_id.trim();
    db::get_sync_state(conn, pack_id)?
        .ok_or_else(|| AppError::msg(format!("Pack not installed: {pack_id}")))
}

fn ensure_existing_pack_not_review_locked(
    conn: &rusqlite::Connection,
    pack_id: &str,
) -> AppResult<()> {
    if let Some(pack) = db::get_sync_state(conn, pack_id.trim())? {
        ensure_pack_not_review_locked(&pack)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct PackInstallConflict {
    pack_id: String,
    name: String,
    local_path: String,
    version: String,
}

fn normalized_pack_name(value: &str) -> &str {
    value.trim()
}

fn local_download_conflict(
    conn: &rusqlite::Connection,
    remote_id: &str,
    remote_name: &str,
) -> AppResult<Option<InstalledPack>> {
    let remote_id = normalized_pack_name(remote_id);
    let remote_name = normalized_pack_name(remote_name);
    let matches = db::list_sync_state(conn)?
        .into_iter()
        .filter(|pack| pack.origin == "local")
        .filter(|pack| {
            let id = normalized_pack_name(&pack.pack_id);
            let name = normalized_pack_name(&pack.name);
            let path = normalized_pack_name(&pack.local_path);
            id == remote_id || path == remote_id || (!remote_name.is_empty() && name == remote_name)
        })
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => Ok(None),
        [pack] => Ok(Some(pack.clone())),
        _ => Err(AppError::msg(
            "More than one local pack conflicts with this Hub pack. Rename the local packs before downloading.",
        )),
    }
}

#[tauri::command]
pub fn hub_download_conflict(
    state: State<'_, SharedState>,
    pack_id: String,
    pack_name: String,
) -> AppResult<Option<PackInstallConflict>> {
    let conflict = {
        let conn = state.db.lock();
        local_download_conflict(&conn, &pack_id, &pack_name)?
    };
    Ok(conflict.map(|pack| PackInstallConflict {
        pack_id: pack.pack_id,
        name: pack.name,
        local_path: pack.local_path,
        version: pack.version,
    }))
}

/// Resolve a pack's working directory and its current snapshot directory
/// (baseline last written at download/sync or approved-release merge time), plus
/// the pack's vault-relative prefix (its `local_path`).
///
/// `snapshot`'s functions work with paths relative to the pack directory
/// itself, but every path the frontend deals in (`TreeNode.path`,
/// `vault_write_file`, etc.) is relative to the vault root and therefore
/// includes this prefix — these commands translate at the boundary so the
/// pack-relative/vault-relative distinction never leaks past this file.
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

#[tauri::command]
pub async fn hub_status(state: State<'_, SharedState>) -> AppResult<hub::HubConnectionStatus> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    Ok(hub::check_hub_status(&settings.hub_base_url, settings.effective_proxy_url()).await)
}

#[tauri::command]
pub async fn hub_test_connection(
    hub_base_url: String,
    proxy_url: Option<String>,
) -> AppResult<hub::HubConnectionStatus> {
    Ok(hub::check_hub_status(&hub_base_url, proxy_url.as_deref().unwrap_or("")).await)
}

#[tauri::command]
pub async fn hub_list_packs(state: State<'_, SharedState>) -> AppResult<Vec<PackProject>> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(state.inner(), &settings, false).await?;
    hub::list_packs_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        token.as_deref(),
    )
    .await
}

#[tauri::command]
pub fn hub_list_installed(state: State<'_, SharedState>) -> AppResult<Vec<InstalledPack>> {
    let vault = state.vault_path();
    let conn = state.db.lock();
    let mut installed = db::list_sync_state(&conn)?;
    // Require real Markdown content — empty leftovers must not count as installed.
    installed.retain(|p| pack_has_markdown(&vault, &p.local_path));
    Ok(installed)
}

#[tauri::command]
pub fn hub_set_pack_active(
    state: State<'_, SharedState>,
    pack_id: String,
    active: bool,
) -> AppResult<()> {
    let conn = state.db.lock();
    db::set_pack_active(&conn, &pack_id, active)
}

fn pack_has_markdown(vault_root: &std::path::Path, local_path: &str) -> bool {
    let dir = vault_root.join(local_path);
    if !dir.is_dir() {
        return false;
    }
    walkdir::WalkDir::new(&dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .any(|e| {
            e.path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
        })
}

#[tauri::command]
pub async fn hub_remove_pack(state: State<'_, SharedState>, pack_id: String) -> AppResult<()> {
    let local_path = {
        let conn = state.db.lock();
        if let Some(installed) = db::get_sync_state(&conn, &pack_id)? {
            installed.local_path
        } else {
            pack_id.clone()
        }
    };

    crate::nest_debug!("hub", "remove_pack id={pack_id} local_path={local_path}");

    let vault = state.vault_path();
    vault::remove_pack(&vault, &local_path)?;
    {
        let conn = state.db.lock();
        db::purge_path_data(&conn, &local_path)?;
        if local_path != pack_id {
            db::purge_path_data(&conn, &pack_id)?;
        }
    }

    // Snapshots are keyed by pack_id and outlive individual versions; a
    // removed pack has no further use for its version-control baselines.
    let snapshots_dir = state.app_data_dir.join("snapshots").join(&pack_id);
    let _ = std::fs::remove_dir_all(&snapshots_dir);

    // Rebuild so FastEmbed vectors stay in sync with the vault (purge only clears FTS/SQL).
    indexing::schedule(state.inner())?;
    Ok(())
}

fn finish_pack_install(
    state: &SharedState,
    pack: &PackMeta,
    origin: &str,
    owner_id: Option<&str>,
) -> AppResult<InstalledPack> {
    let installed = {
        let conn = state.db.lock();
        hub::record_sync(&conn, pack, origin, owner_id)?;
        db::get_sync_state(&conn, &pack.id)?.ok_or_else(|| {
            AppError::msg(format!("Installed pack record was not saved: {}", pack.id))
        })?
    };
    indexing::schedule(state)?;
    Ok(installed)
}

#[tauri::command]
// Tauri exposes command parameters as individually named invoke arguments.
// Keeping them explicit preserves the existing frontend command contract.
#[allow(clippy::too_many_arguments)]
pub async fn hub_download_pack(
    state: State<'_, SharedState>,
    pack_id: String,
    pack_name: String,
    version: Option<String>,
    owner_id: Option<String>,
    replace_local_pack_id: Option<String>,
    sync_patch: Option<bool>,
    merge_resolutions: Option<Vec<crate::snapshot::MergeResolution>>,
    merge_preview_token: Option<String>,
) -> AppResult<InstalledPack> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    {
        let conn = state.db.lock();
        ensure_existing_pack_not_review_locked(&conn, &pack_id)?;
        if let Some(replaced) = replace_local_pack_id.as_deref() {
            ensure_existing_pack_not_review_locked(&conn, replaced)?;
        }
    }

    let vault = state.vault_path();
    if sync_patch.unwrap_or(false) {
        let installed = {
            let conn = state.db.lock();
            require_installed_pack(&conn, &pack_id)?
        };
        if version.as_deref() != Some(installed.version.as_str()) {
            return Err(AppError::msg(
                "A live patch must sync the currently installed release",
            ));
        }
    }
    let conflict = {
        let conn = state.db.lock();
        local_download_conflict(&conn, &pack_id, &pack_name)?
    };
    match (&conflict, replace_local_pack_id.as_deref()) {
        (Some(local), Some(confirmed)) if local.pack_id == confirmed => {}
        (Some(local), _) => {
            return Err(AppError::msg(format!(
                "Downloading this pack would replace the local pack “{}”. Confirm the replacement first.",
                local.name
            )));
        }
        (None, Some(_)) => {
            return Err(AppError::msg(
                "The local pack changed before the download started. Please try again.",
            ));
        }
        (None, None) => {}
    }

    let staging = vault.join(format!(".nest-download-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging)?;
    let token = ensure_hub_access(state.inner(), &settings, false).await?;
    let downloaded = hub::download_pack_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &pack_id,
        version.as_deref(),
        &staging,
        token.as_deref(),
    )
    .await;
    let downloaded = match downloaded {
        Ok(pack) => pack,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let pack = downloaded.pack;
    let patch_revision = downloaded.patch_revision;
    if pack.id != pack_id {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::msg(format!(
            "Downloaded pack id mismatch: expected {pack_id}, found {}",
            pack.id
        )));
    }
    if Path::new(&pack.path).components().count() != 1
        || !matches!(
            Path::new(&pack.path).components().next(),
            Some(Component::Normal(_))
        )
    {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::msg("Downloaded pack has an unsafe local path"));
    }

    // Recheck immediately before changing files so a concurrently imported
    // local pack cannot be overwritten without consent.
    let current_conflict = {
        let conn = state.db.lock();
        local_download_conflict(&conn, &pack_id, &pack_name)?
    };
    if current_conflict.as_ref().map(|p| p.pack_id.as_str()) != replace_local_pack_id.as_deref() {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::msg(
            "The local packs changed while downloading. Review the conflict and try again.",
        ));
    }

    let mut staged_pack = staging.join(&pack.path);
    if !staged_pack.is_dir() {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::msg(
            "The downloaded archive did not contain the expected pack folder",
        ));
    }
    let approved_snapshot_source = if sync_patch.unwrap_or(false) {
        let installed = {
            let conn = state.db.lock();
            require_installed_pack(&conn, &pack_id)?
        };
        let local_dir = vault.join(&installed.local_path);
        let base_dir = crate::snapshot::snapshot_root(
            &state.app_data_dir,
            &installed.pack_id,
            &installed.version,
        );
        let approved_dir = staging.join(".approved-patch");
        fs::rename(&staged_pack, &approved_dir)?;
        let merged_dir = staging.join(&pack.path);
        if let Err(error) = crate::snapshot::build_three_way_merge(
            &base_dir,
            &local_dir,
            &approved_dir,
            &merged_dir,
            merge_resolutions.as_deref().unwrap_or_default(),
            merge_preview_token.as_deref(),
        ) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        staged_pack = merged_dir;
        Some(approved_dir)
    } else {
        None
    };
    let target = vault.join(&pack.path);
    let backup_root = vault.join(format!(".nest-download-backup-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&backup_root)?;
    let mut backups: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut old_paths = Vec::new();
    if let Some(local) = &current_conflict {
        old_paths.push(vault.join(&local.local_path));
    }
    if target.exists() && !old_paths.iter().any(|path| path == &target) {
        old_paths.push(target.clone());
    }
    for (index, old_path) in old_paths.iter().enumerate() {
        if old_path.exists() {
            let backup = backup_root.join(index.to_string());
            if let Err(error) = fs::rename(old_path, &backup) {
                for (original, saved) in backups.iter().rev() {
                    let _ = fs::rename(saved, original);
                }
                let _ = fs::remove_dir_all(&staging);
                let _ = fs::remove_dir_all(&backup_root);
                return Err(error.into());
            }
            backups.push((old_path.clone(), backup));
        }
    }
    if let Err(error) = fs::rename(&staged_pack, &target) {
        for (original, saved) in backups.iter().rev() {
            let _ = fs::rename(saved, original);
        }
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&backup_root);
        return Err(error.into());
    }

    // Baseline for local version control: "modified" is computed against
    // this snapshot until the next re-sync to a newer version.
    let snapshot_dir = crate::snapshot::snapshot_root(&state.app_data_dir, &pack.id, &pack.version);
    let snapshot_backup = staging.join(".previous-snapshot");
    let had_snapshot = snapshot_dir.is_dir();
    if had_snapshot {
        if let Err(error) = copy_directory_exact(&snapshot_dir, &snapshot_backup) {
            let _ = fs::remove_dir_all(&target);
            for (original, saved) in backups.iter().rev() {
                let _ = fs::rename(saved, original);
            }
            let _ = fs::remove_dir_all(&staging);
            let _ = fs::remove_dir_all(&backup_root);
            return Err(error);
        }
    }
    if let Err(error) = crate::snapshot::write_snapshot(
        &state.app_data_dir,
        &pack.id,
        &pack.version,
        approved_snapshot_source.as_deref().unwrap_or(&target),
    ) {
        let _ = fs::remove_dir_all(&target);
        for (original, saved) in backups.iter().rev() {
            let _ = fs::rename(saved, original);
        }
        let _ = fs::remove_dir_all(&snapshot_dir);
        if had_snapshot {
            let _ = fs::rename(&snapshot_backup, &snapshot_dir);
        }
        let _ = fs::remove_dir_all(&staging);
        let _ = fs::remove_dir_all(&backup_root);
        return Err(error);
    }

    let finalized = (|| -> AppResult<InstalledPack> {
        let mut conn = state.db.lock();
        let transaction = conn.transaction()?;
        if let Some(local) = &current_conflict {
            if local.pack_id != pack.id {
                db::purge_path_data(&transaction, &local.local_path)?;
            }
        }
        hub::record_sync_with_patch(
            &transaction,
            &pack,
            "registry",
            owner_id.as_deref(),
            patch_revision,
        )?;
        let installed = db::get_sync_state(&transaction, &pack.id)?.ok_or_else(|| {
            AppError::msg(format!("Installed pack record was not saved: {}", pack.id))
        })?;
        transaction.commit()?;
        Ok(installed)
    })();
    let installed = match finalized {
        Ok(installed) => installed,
        Err(error) => {
            let _ = fs::remove_dir_all(&target);
            for (original, saved) in backups.iter().rev() {
                let _ = fs::rename(saved, original);
            }
            let _ = fs::remove_dir_all(&snapshot_dir);
            if had_snapshot {
                let _ = fs::rename(&snapshot_backup, &snapshot_dir);
            }
            let _ = fs::remove_dir_all(&staging);
            let _ = fs::remove_dir_all(&backup_root);
            return Err(error);
        }
    };
    if let Some(local) = &current_conflict {
        if local.pack_id != pack.id {
            let _ = fs::remove_dir_all(state.app_data_dir.join("snapshots").join(&local.pack_id));
        }
    }
    indexing::schedule(state.inner())?;
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&backup_root);
    Ok(installed)
}

#[tauri::command]
pub async fn hub_import_local_pack(
    state: State<'_, SharedState>,
    source_path: String,
    overwrite: bool,
) -> AppResult<InstalledPack> {
    let source = std::path::PathBuf::from(source_path.trim());
    crate::nest_debug!("hub", "import_local_pack source={}", source.display());

    let vault = state.vault_path();
    let inspected = hub::inspect_local_pack(&source, &vault)?;
    {
        let conn = state.db.lock();
        ensure_existing_pack_not_review_locked(&conn, &inspected.metadata.id)?;
    }
    if !overwrite {
        let conn = state.db.lock();
        if db::get_sync_state(&conn, &inspected.metadata.id)?.is_some() {
            return Err(AppError::msg(format!(
                "Knowledge pack '{}' is already installed",
                inspected.metadata.id
            )));
        }
    }
    let pack = hub::import_local_pack(&source, &vault, overwrite)?;
    // Baseline the version-control snapshot at "what was just imported" —
    // otherwise every pre-existing file in the import would show as New.
    crate::snapshot::write_snapshot(
        &state.app_data_dir,
        &pack.id,
        &pack.version,
        &vault.join(&pack.path),
    )?;
    finish_pack_install(state.inner(), &pack, "local", None)
}

#[tauri::command]
pub fn hub_inspect_local_pack(
    state: State<'_, SharedState>,
    source_path: String,
) -> AppResult<hub::LocalPackInspection> {
    hub::inspect_local_pack(
        std::path::Path::new(source_path.trim()),
        &state.vault_path(),
    )
}

#[tauri::command]
pub async fn hub_create_pack_from_zip(
    state: State<'_, SharedState>,
    source_path: String,
    metadata: PackMeta,
    overwrite: bool,
) -> AppResult<InstalledPack> {
    {
        let conn = state.db.lock();
        ensure_existing_pack_not_review_locked(&conn, metadata.id.trim())?;
    }
    if !overwrite {
        let conn = state.db.lock();
        if db::get_sync_state(&conn, metadata.id.trim())?.is_some() {
            return Err(AppError::msg(format!(
                "Knowledge pack '{}' is already installed",
                metadata.id.trim()
            )));
        }
    }
    let vault = state.vault_path();
    let pack = hub::create_pack_from_zip(
        std::path::Path::new(source_path.trim()),
        metadata,
        &vault,
        overwrite,
    )?;
    crate::snapshot::write_snapshot(
        &state.app_data_dir,
        &pack.id,
        &pack.version,
        &vault.join(&pack.path),
    )?;
    finish_pack_install(state.inner(), &pack, "local", None)
}

#[tauri::command]
pub fn hub_read_folder_pack_defaults(source_path: String) -> AppResult<hub::FolderPackDefaults> {
    hub::folder_pack_defaults(std::path::Path::new(source_path.trim()))
}

#[tauri::command]
pub async fn hub_create_pack_from_folder(
    state: State<'_, SharedState>,
    source_path: String,
    metadata: PackMeta,
    overwrite: bool,
) -> AppResult<InstalledPack> {
    {
        let conn = state.db.lock();
        ensure_existing_pack_not_review_locked(&conn, metadata.id.trim())?;
    }
    if !overwrite {
        let conn = state.db.lock();
        if db::get_sync_state(&conn, metadata.id.trim())?.is_some() {
            return Err(AppError::msg(format!(
                "Knowledge pack '{}' is already installed",
                metadata.id.trim()
            )));
        }
    }
    let vault = state.vault_path();
    let pack = hub::create_pack_from_folder(
        std::path::Path::new(source_path.trim()),
        metadata,
        &vault,
        overwrite,
    )?;
    // Same reasoning as hub_import_local_pack: baseline at "what was just
    // brought in" so pre-existing files don't show as New.
    crate::snapshot::write_snapshot(
        &state.app_data_dir,
        &pack.id,
        &pack.version,
        &vault.join(&pack.path),
    )?;
    finish_pack_install(state.inner(), &pack, "local", None)
}

#[tauri::command]
pub async fn hub_create_empty_pack(
    state: State<'_, SharedState>,
    metadata: PackMeta,
) -> AppResult<InstalledPack> {
    let vault = state.vault_path();
    let pack = hub::create_empty_pack(metadata, &vault)?;
    finish_pack_install(state.inner(), &pack, "local", None)
}

#[tauri::command]
pub fn hub_export_pack(
    state: State<'_, SharedState>,
    pack_id: String,
    destination_path: String,
) -> AppResult<()> {
    let pack = {
        let conn = state.db.lock();
        let installed = require_installed_pack(&conn, &pack_id)?;
        PackMeta {
            id: installed.pack_id,
            name: installed.name,
            description: String::new(),
            version: installed.version,
            path: installed.local_path,
        }
    };
    let mut destination = std::path::PathBuf::from(destination_path.trim());
    if !destination
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        destination.set_extension("zip");
    }
    hub::export_pack(&pack, &state.vault_path(), &destination)
}

/// Persist the Hub refresh token in the local `settings` table — the same
/// storage and guarantees as everything else in Settings (e.g.
/// `llm_api_key`), not the OS keychain. Errors are logged rather than
/// propagated — a failed write shouldn't fail login itself, but it must not
/// be swallowed silently either, since a silent failure here is
/// indistinguishable from "never logged in" on the next launch.
///
/// This used to go through the OS keychain, but on an ad-hoc-signed build
/// (no Apple Developer Team ID, `signingIdentity: "-"` in tauri.conf.json)
/// macOS does not reliably persist Keychain items across process launches —
/// `SecItemAdd` can report success while the item is unreadable by the very
/// next launch of the same binary — which made the Hub session silently
/// fail to survive an app restart.
fn store_refresh_token(state: &SharedState, refresh_token: &str) {
    let conn = state.db.lock();
    match db::set_hub_refresh_token(&conn, Some(refresh_token)) {
        Ok(()) => crate::nest_debug!("hub", "stored refresh token in settings"),
        Err(error) => crate::nest_debug!("hub", "failed to store refresh token: {error}"),
    }
}

fn clear_refresh_token(state: &SharedState) {
    let conn = state.db.lock();
    if let Err(error) = db::set_hub_refresh_token(&conn, None) {
        crate::nest_debug!("hub", "failed to clear refresh token: {error}");
    }
}

fn load_refresh_token(state: &SharedState) -> Option<String> {
    let conn = state.db.lock();
    match db::get_hub_refresh_token(&conn) {
        Ok(Some(token)) => {
            crate::nest_debug!("hub", "loaded refresh token from settings");
            Some(token)
        }
        Ok(None) => {
            crate::nest_debug!("hub", "no refresh token in settings");
            None
        }
        Err(error) => {
            crate::nest_debug!("hub", "failed to read refresh token: {error}");
            None
        }
    }
}

#[tauri::command]
pub async fn hub_auth_state(state: State<'_, SharedState>) -> AppResult<hub::AuthState> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let _ = ensure_hub_access(state.inner(), &settings, false).await;
    let auth = state.hub_auth.lock();
    let user = auth.as_ref().map(|session| session.user.clone());
    drop(auth);
    Ok(hub::AuthState {
        authenticated: user.is_some(),
        user,
    })
}

#[tauri::command]
pub async fn hub_login(
    state: State<'_, SharedState>,
    id: String,
    password: String,
) -> AppResult<hub::AuthState> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let session = hub::login_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        id.trim(),
        &password,
    )
    .await?;
    store_refresh_token(state.inner(), &session.refresh_token);
    let user = session.user.clone();
    *state.hub_auth.lock() = Some(session);
    Ok(hub::AuthState {
        authenticated: true,
        user: Some(user),
    })
}

#[tauri::command]
pub async fn hub_register(
    state: State<'_, SharedState>,
    id: String,
    password: String,
    name: String,
) -> AppResult<hub::AuthState> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let session = hub::register_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        id.trim(),
        &password,
        name.trim(),
    )
    .await?;
    store_refresh_token(state.inner(), &session.refresh_token);
    let user = session.user.clone();
    *state.hub_auth.lock() = Some(session);
    Ok(hub::AuthState {
        authenticated: true,
        user: Some(user),
    })
}

#[tauri::command]
pub fn hub_logout(state: State<'_, SharedState>) -> AppResult<()> {
    state.hub_auth.lock().take();
    clear_refresh_token(state.inner());
    Ok(())
}

#[tauri::command]
pub async fn hub_update_profile(
    state: State<'_, SharedState>,
    name: String,
) -> AppResult<hub::HubUser> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(&state, &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to update your Hub profile"))?;
    let user = hub::update_profile_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        name.trim(),
    )
    .await?;
    if let Some(session) = state.hub_auth.lock().as_mut() {
        session.user = user.clone();
    }
    Ok(user)
}

#[tauri::command]
pub async fn hub_change_password(
    state: State<'_, SharedState>,
    current_password: String,
    new_password: String,
) -> AppResult<hub::AuthState> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(&state, &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to change your Hub password"))?;
    let session = hub::change_password_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        &current_password,
        &new_password,
    )
    .await?;
    store_refresh_token(state.inner(), &session.refresh_token);
    let user = session.user.clone();
    *state.hub_auth.lock() = Some(session);
    Ok(hub::AuthState {
        authenticated: true,
        user: Some(user),
    })
}

#[tauri::command]
pub async fn hub_publish_release(
    state: State<'_, SharedState>,
    pack_id: String,
    version: String,
    commit_message: String,
) -> AppResult<hub::PublishRequest> {
    publish_pack(
        state.inner(),
        pack_id,
        PublishOperation::Release {
            version,
            commit_message,
        },
    )
    .await
}

#[tauri::command]
pub async fn hub_publish_live_patch(
    state: State<'_, SharedState>,
    pack_id: String,
    target_version: String,
    commit_message: String,
) -> AppResult<hub::PublishRequest> {
    publish_pack(
        state.inner(),
        pack_id,
        PublishOperation::LivePatch {
            target_version,
            commit_message,
        },
    )
    .await
}

enum PublishOperation {
    Release {
        version: String,
        commit_message: String,
    },
    LivePatch {
        target_version: String,
        commit_message: String,
    },
}

impl PublishOperation {
    fn request_type(&self) -> &'static str {
        match self {
            Self::Release { .. } => "release",
            Self::LivePatch { .. } => "live_patch",
        }
    }

    fn commit_message(&self) -> &str {
        match self {
            Self::Release { commit_message, .. } | Self::LivePatch { commit_message, .. } => {
                commit_message
            }
        }
    }
}

async fn publish_operation_remote(
    operation: &PublishOperation,
    settings: &db::AppSettings,
    token: &str,
    pack: &PackMeta,
    source_local_path: &str,
    vault: &Path,
) -> AppResult<hub::PublishRequest> {
    match operation {
        PublishOperation::Release { commit_message, .. } => {
            hub::publish_release_remote(
                &settings.hub_base_url,
                settings.effective_proxy_url(),
                token,
                pack,
                source_local_path,
                vault,
                commit_message,
            )
            .await
        }
        PublishOperation::LivePatch { commit_message, .. } => {
            hub::publish_live_patch_remote(
                &settings.hub_base_url,
                settings.effective_proxy_url(),
                token,
                pack,
                source_local_path,
                vault,
                commit_message,
            )
            .await
        }
    }
}

async fn publish_pack(
    state: &SharedState,
    pack_id: String,
    operation: PublishOperation,
) -> AppResult<hub::PublishRequest> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(state, &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to publish a knowledge pack"))?;
    let mut installed = {
        let conn = state.db.lock();
        require_installed_pack(&conn, &pack_id)?
    };
    ensure_pack_publishable(&installed)?;
    let commit_message = operation.commit_message().trim();
    if commit_message.is_empty() {
        return Err(AppError::msg("Publish commit message is required"));
    }
    if commit_message.chars().count() > 500 {
        return Err(AppError::msg(
            "Publish commit message must be 500 characters or fewer",
        ));
    }
    if let Some(pending_version) = &installed.pending_version {
        return Err(AppError::msg(format!(
            "{} already has a submission awaiting review (v{pending_version}). Wait for it to be approved or rejected before submitting again.",
            installed.name,
        )));
    }
    if installed.origin == "local" && hub::slugify_pack_id(&installed.pack_id) != installed.pack_id
    {
        installed = migrate_legacy_local_pack_for_publish(state, &installed)?;
    }
    let vault = state.vault_path();
    let source_local_path = installed.local_path.clone();
    let pack = match &operation {
        PublishOperation::Release { version, .. } => {
            let version = version.trim();
            if version.is_empty() {
                return Err(AppError::msg("Release version is required"));
            }
            if version != installed.version {
                hub::update_pack_version(&vault.join(&installed.local_path), version)?;
            }
            PackMeta {
                id: installed.pack_id.clone(),
                name: installed.name.clone(),
                description: installed.description.clone(),
                version: version.to_string(),
                path: installed.local_path.clone(),
            }
        }
        PublishOperation::LivePatch { target_version, .. } => {
            let target_version = target_version.trim();
            if target_version.is_empty() {
                return Err(AppError::msg("Live patch target version is required"));
            }
            let release = hub::get_release_remote(
                &settings.hub_base_url,
                settings.effective_proxy_url(),
                &token,
                &installed.pack_id,
                target_version,
            )
            .await?;
            if release.yanked {
                return Err(AppError::msg("Yanked releases cannot be live patched"));
            }
            PackMeta {
                id: release.id,
                name: release.name,
                description: release.description,
                version: release.version,
                path: release.path,
            }
        }
    };
    let expected_request_type = operation.request_type();
    let published = publish_operation_remote(
        &operation,
        &settings,
        &token,
        &pack,
        &source_local_path,
        &vault,
    )
    .await;
    let result = match published {
        Err(error) if error.is_unauthorized() => {
            let token = ensure_hub_access(state, &settings, true)
                .await?
                .ok_or_else(|| AppError::msg("Your Hub session expired. Sign in again."))?;
            publish_operation_remote(
                &operation,
                &settings,
                &token,
                &pack,
                &source_local_path,
                &vault,
            )
            .await
        }
        result => result,
    };
    if let Ok(request) = &result {
        if request.request_type != expected_request_type {
            return Err(AppError::msg(format!(
                "Hub returned {} for a {expected_request_type} submission; local pending state was not changed",
                request.request_type
            )));
        }
        // Don't advance `version` or the M/N/D snapshot baseline yet — the
        // request is only pending, not approved. Just record that this pack
        // now has an unresolved submission; hub_reconcile_publish_requests
        // is what advances things once the Hub actually resolves it.
        let conn = state.db.lock();
        db::set_pending_publish(
            &conn,
            &pack.id,
            db::PendingPublishUpdate {
                request_id: &request.id,
                version: &pack.version,
                created_at: Some(&request.created_at),
                request_type: &request.request_type,
                patch_revision: request.patch_revision,
                can_cancel: true,
                submitter_id: request.submitter_id.as_deref(),
                submitter_name: request.submitter_name.as_deref(),
            },
        )?;
    }
    result
}

/// Reconciles every publishable installed pack's locally-known pending-review
/// state against the Hub's actual state, and returns the refreshed pack list.
/// A no-op (just returns the current list) when not signed in — safe to call
/// unconditionally without the frontend gating on auth state first.
#[tauri::command]
pub async fn hub_reconcile_publish_requests(
    state: State<'_, SharedState>,
) -> AppResult<Vec<InstalledPack>> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let Some(token) = ensure_hub_access(state.inner(), &settings, false).await? else {
        let conn = state.db.lock();
        return db::list_sync_state(&conn);
    };
    let installed = {
        let conn = state.db.lock();
        db::list_sync_state(&conn)?
    };
    for pack in installed
        .iter()
        .filter(|p| p.origin == "local" || p.origin == "registry")
    {
        reconcile_one_pack(&state, &settings, &token, pack).await;
    }
    let conn = state.db.lock();
    db::list_sync_state(&conn)
}

#[tauri::command]
pub async fn hub_cancel_publish_request(
    state: State<'_, SharedState>,
    pack_id: String,
    request_id: String,
) -> AppResult<InstalledPack> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(state.inner(), &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to cancel a publish request"))?;
    let installed = {
        let conn = state.db.lock();
        require_installed_pack(&conn, &pack_id)?
    };
    if installed.publish_review_status.as_deref() != Some("pending")
        || installed.pending_request_id.as_deref() != Some(request_id.as_str())
    {
        return Err(AppError::msg(
            "This publish request is no longer pending for the pack",
        ));
    }
    if !installed.pending_can_cancel {
        return Err(AppError::msg(
            "Only the original submitter can cancel this publish request",
        ));
    }

    let cancelled = hub::cancel_publish_request_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        &request_id,
    )
    .await?;
    if !cancelled.success || cancelled.request_id != request_id || cancelled.pack_id != pack_id {
        return Err(AppError::msg(
            "Hub returned an invalid publish cancellation response",
        ));
    }
    let conn = state.db.lock();
    let current = require_installed_pack(&conn, &pack_id)?;
    if current.pending_request_id.as_deref() == Some(request_id.as_str()) {
        db::clear_pending_publish(&conn, &pack_id)?;
    }
    require_installed_pack(&conn, &pack_id)
}

/// Best-effort per pack — a transient network error or a lookup this device
/// can't see (e.g. someone else's request) must not abort reconciliation for
/// the rest of the library, so every fallible step here just skips forward.
async fn reconcile_one_pack(
    state: &SharedState,
    settings: &AppSettings,
    token: &str,
    pack: &InstalledPack,
) {
    // Preserve an approved action until the user explicitly merges it. A
    // newer pack-wide request must not overwrite the exact release this
    // device still needs to baseline.
    if pack.publish_review_status.as_deref() == Some("approved_awaiting_merge") {
        return;
    }
    let Ok(remote_pending) = hub::get_pack_pending_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        token,
        &pack.pack_id,
    )
    .await
    else {
        return;
    };

    if let Some(remote) = remote_pending {
        // Hub says pending — possibly a request this device didn't submit
        // itself (a teammate/admin publishing the same pack elsewhere).
        let conn = state.db.lock();
        let _ = db::set_pending_publish(
            &conn,
            &pack.pack_id,
            db::PendingPublishUpdate {
                request_id: &remote.id,
                version: &remote.version,
                created_at: Some(&remote.created_at),
                request_type: &remote.request_type,
                patch_revision: remote.patch_revision,
                can_cancel: remote.can_cancel,
                submitter_id: remote.submitter_id.as_deref(),
                submitter_name: remote.submitter_name.as_deref(),
            },
        );
        return;
    }

    let Some(request_id) = &pack.pending_request_id else {
        return;
    };
    // We locally thought this pack still had a pending request; the Hub now
    // says it doesn't, so it just resolved. Learn the outcome to decide
    // whether to advance the version/snapshot baseline.
    let resolved = match hub::get_publish_request_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        token,
        request_id,
    )
    .await
    {
        Ok(resolved) => resolved,
        Err(AppError::HubResponse { status: 404, .. }) => {
            // Cancelled requests are deleted by the Hub. A confirmed 404,
            // unlike a network/auth failure, safely releases this stale lock.
            let conn = state.db.lock();
            let _ = db::clear_pending_publish(&conn, &pack.pack_id);
            return;
        }
        Err(_) => {
            // Keep the local marker when the resolution cannot be confirmed.
            // A transient network/auth failure must never discard a merge action.
            return;
        }
    };
    if resolved.status == "approved" {
        let conn = state.db.lock();
        let _ = db::set_publish_approved_awaiting_merge(
            &conn,
            &pack.pack_id,
            request_id,
            &resolved.version,
        );
        return;
    }
    if resolved.status != "rejected" {
        return;
    }
    // Rejection releases the lock while retaining every local edit.
    let conn = state.db.lock();
    let _ = db::clear_pending_publish(&conn, &pack.pack_id);
}

/// Promote an approved publish request to the local remote-synced baseline.
#[derive(Debug, Clone, Serialize)]
pub struct PackMergePreview {
    pub pack_id: String,
    pub version: String,
    pub patch_revision: i64,
    pub request_id: Option<String>,
    pub conflicts: Vec<crate::snapshot::MergeConflict>,
    pub merged_file_count: usize,
    pub preview_token: String,
}

async fn preview_remote_merge(
    state: &SharedState,
    pack_id: &str,
    version: &str,
    request_id: Option<String>,
) -> AppResult<PackMergePreview> {
    let (settings, installed) = {
        let conn = state.db.lock();
        (
            db::get_settings(&conn)?,
            require_installed_pack(&conn, pack_id)?,
        )
    };
    let token = ensure_hub_access(state, &settings, false).await?;
    let staging = std::env::temp_dir().join(format!(
        "nest-merge-preview-{}-{}",
        pack_id,
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&staging)?;
    let downloaded = hub::download_pack_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        pack_id,
        Some(version),
        &staging,
        token.as_deref(),
    )
    .await;
    let downloaded = match downloaded {
        Ok(value) => value,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let approved_dir = staging.join(&downloaded.pack.path);
    let local_dir = state.vault_path().join(&installed.local_path);
    let base_dir =
        crate::snapshot::snapshot_root(&state.app_data_dir, &installed.pack_id, &installed.version);
    let analysis = crate::snapshot::analyze_three_way(&base_dir, &local_dir, &approved_dir);
    let _ = fs::remove_dir_all(&staging);
    let analysis = analysis?;
    Ok(PackMergePreview {
        pack_id: pack_id.to_string(),
        version: downloaded.pack.version,
        patch_revision: downloaded.patch_revision,
        request_id,
        conflicts: analysis.conflicts,
        merged_file_count: analysis.merged_file_count,
        preview_token: analysis.preview_token,
    })
}

#[tauri::command]
pub async fn hub_preview_approved_merge(
    state: State<'_, SharedState>,
    pack_id: String,
    request_id: String,
) -> AppResult<PackMergePreview> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(state.inner(), &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to merge an approved knowledge pack"))?;
    let request = hub::get_publish_request_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        &request_id,
    )
    .await?;
    if request.pack_id != pack_id || request.status != "approved" {
        return Err(AppError::msg(
            "This publish request is not an approved update for the pack",
        ));
    }
    preview_remote_merge(state.inner(), &pack_id, &request.version, Some(request_id)).await
}

#[tauri::command]
pub async fn hub_preview_pack_patch(
    state: State<'_, SharedState>,
    pack_id: String,
) -> AppResult<PackMergePreview> {
    let installed = {
        let conn = state.db.lock();
        require_installed_pack(&conn, &pack_id)?
    };
    let preview = preview_remote_merge(state.inner(), &pack_id, &installed.version, None).await?;
    if preview.patch_revision <= installed.patch_revision {
        return Err(AppError::msg("No newer live patch is available"));
    }
    Ok(preview)
}

/// Promote an approved publish request to the local remote-synced baseline,
/// preserving non-conflicting local work and requiring explicit choices for
/// every true three-way conflict.
#[tauri::command]
pub async fn hub_merge_approved_pack(
    state: State<'_, SharedState>,
    pack_id: String,
    request_id: String,
    resolutions: Option<Vec<crate::snapshot::MergeResolution>>,
    preview_token: Option<String>,
) -> AppResult<InstalledPack> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(state.inner(), &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to merge an approved knowledge pack"))?;
    let installed = {
        let conn = state.db.lock();
        require_installed_pack(&conn, &pack_id)?
    };

    let request = hub::get_publish_request_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        &request_id,
    )
    .await?;
    if request.pack_id != pack_id {
        return Err(AppError::msg("The approval does not belong to this pack"));
    }
    if request.status != "approved" {
        return Err(AppError::msg(
            "Only an approved publish request can be merged",
        ));
    }
    if installed.origin == "registry"
        && installed.version == request.version
        && installed.publish_review_status.is_none()
    {
        return Ok(installed);
    }
    if installed.pending_request_id.as_deref() != Some(request_id.as_str())
        || installed.publish_review_status.as_deref() != Some("approved_awaiting_merge")
    {
        return Err(AppError::msg(
            "This approval is not awaiting merge on the local pack",
        ));
    }

    let staging = std::env::temp_dir().join(format!(
        "nest-approved-merge-{}-{}",
        pack_id,
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&staging)?;
    let downloaded = hub::download_pack_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &pack_id,
        Some(&request.version),
        &staging,
        Some(&token),
    )
    .await;
    let downloaded = match downloaded {
        Ok(pack) => pack,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let approved = downloaded.pack;
    let patch_revision = downloaded.patch_revision;
    if approved.id != pack_id || approved.version != request.version {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::msg(
            "The downloaded Hub release does not match the approval",
        ));
    }
    let approved_dir = staging.join(&approved.path);
    let local_dir = state.vault_path().join(&installed.local_path);
    let base_dir =
        crate::snapshot::snapshot_root(&state.app_data_dir, &installed.pack_id, &installed.version);
    let merged_dir = staging.join(".merged");
    crate::snapshot::build_three_way_merge(
        &base_dir,
        &local_dir,
        &approved_dir,
        &merged_dir,
        resolutions.as_deref().unwrap_or_default(),
        preview_token.as_deref(),
    )?;
    let snapshot_dir =
        crate::snapshot::snapshot_root(&state.app_data_dir, &approved.id, &approved.version);
    let snapshot_backup = staging.join(".snapshot-backup");
    let had_snapshot = snapshot_dir.is_dir();
    if had_snapshot {
        copy_directory_exact(&snapshot_dir, &snapshot_backup)?;
    }
    let backup_dir = staging.join(".local-backup");
    fs::rename(&local_dir, &backup_dir)?;
    if let Err(error) = fs::rename(&merged_dir, &local_dir) {
        let _ = fs::rename(&backup_dir, &local_dir);
        let _ = fs::remove_dir_all(&staging);
        return Err(error.into());
    }
    let snapshot_result = crate::snapshot::write_snapshot(
        &state.app_data_dir,
        &approved.id,
        &approved.version,
        &approved_dir,
    );
    if let Err(error) = snapshot_result {
        let _ = fs::remove_dir_all(&local_dir);
        let _ = fs::rename(&backup_dir, &local_dir);
        let _ = fs::remove_dir_all(&snapshot_dir);
        if had_snapshot {
            let _ = fs::rename(&snapshot_backup, &snapshot_dir);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    let remote_owner_id = hub::list_packs_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        Some(&token),
    )
    .await
    .ok()
    .and_then(|projects| {
        projects
            .into_iter()
            .find(|project| project.id == pack_id)
            .and_then(|project| project.owner_id)
    });
    let result = (|| -> AppResult<InstalledPack> {
        let mut conn = state.db.lock();
        let transaction = conn.transaction()?;
        let owner_id = remote_owner_id.as_deref().or(installed.owner_id.as_deref());
        hub::record_sync_with_patch(
            &transaction,
            &approved,
            "registry",
            owner_id,
            patch_revision,
        )?;
        db::clear_pending_publish(&transaction, &pack_id)?;
        let merged = db::get_sync_state(&transaction, &pack_id)?
            .ok_or_else(|| AppError::msg("Merged pack state was not saved"))?;
        transaction.commit()?;
        Ok(merged)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&local_dir);
        let _ = fs::rename(&backup_dir, &local_dir);
        let _ = fs::remove_dir_all(&snapshot_dir);
        if had_snapshot {
            let _ = fs::rename(&snapshot_backup, &snapshot_dir);
        }
    }
    if result.is_ok() {
        let _ = indexing::schedule(state.inner());
    }
    let _ = fs::remove_dir_all(&staging);
    result
}

/// Local sanity gate only — real ownership is enforced by the hub itself
/// (`publishing.service.ts`'s `submit()` rejects non-owners/non-admins with
/// 403), so it's safe to let any locally-created/imported pack *or* any
/// downloaded pack attempt to publish here. Bundled defaults and
/// unknown-origin packs are excluded since there's nothing coherent to
/// submit for those.
fn ensure_pack_publishable(installed: &db::InstalledPack) -> AppResult<()> {
    if installed.origin == "local" || installed.origin == "registry" {
        Ok(())
    } else {
        Err(AppError::msg(
            "Only local or downloaded knowledge packs can be published",
        ))
    }
}

/// Update a pack's description, both in its on-disk `pack.json` and in
/// `sync_state`. Used to save an edit made right before publishing so the
/// submission reflects it — works for any pack the user can edit, since a
/// description edit never touches the pack's identity/folder.
#[tauri::command]
pub fn hub_update_pack_metadata(
    state: State<'_, SharedState>,
    pack_id: String,
    description: String,
) -> AppResult<InstalledPack> {
    let installed = {
        let conn = state.db.lock();
        require_installed_pack(&conn, &pack_id)?
    };
    ensure_pack_not_review_locked(&installed)?;
    let pack_dir = state.vault_path().join(&installed.local_path);
    let updated = hub::update_pack_description(&pack_dir, &description)?;
    let conn = state.db.lock();
    db::upsert_sync_state(
        &conn,
        db::SyncStateUpsert {
            pack_id: &installed.pack_id,
            name: &installed.name,
            version: &installed.version,
            local_path: &installed.local_path,
            origin: &installed.origin,
            owner_id: installed.owner_id.as_deref(),
            description: &updated.description,
            patch_revision: installed.patch_revision,
        },
    )?;
    db::get_sync_state(&conn, &installed.pack_id)?
        .ok_or_else(|| AppError::msg(format!("Pack not installed: {}", installed.pack_id)))
}

fn finish_local_pack_identity_change(
    state: &SharedState,
    installed: &InstalledPack,
    updated: PackMeta,
) -> AppResult<InstalledPack> {
    crate::snapshot::rename_snapshot_root(&state.app_data_dir, &installed.pack_id, &updated.id)?;

    {
        let conn = state.db.lock();
        db::purge_chunks_for_path(&conn, &installed.local_path)?;
        db::rename_sync_state_pack(&conn, &installed.pack_id, &updated.id, &updated.name)?;
    }
    indexing::schedule(state)?;

    let conn = state.db.lock();
    db::get_sync_state(&conn, &updated.id)?
        .ok_or_else(|| AppError::msg("Renamed pack record was not saved"))
}

fn migrate_legacy_local_pack_for_publish(
    state: &SharedState,
    installed: &InstalledPack,
) -> AppResult<InstalledPack> {
    let updated = hub::migrate_local_pack_id_for_publish(
        &state.vault_path(),
        &installed.local_path,
        &installed.pack_id,
        &installed.name,
    )?;
    finish_local_pack_identity_change(state, installed, updated)
}

/// Renames a local pack's display name and registry-safe identity together.
/// Downloaded (`registry`) packs, and bundled/unknown-origin ones, keep the
/// identity the Hub already tracks.
#[tauri::command]
pub fn hub_rename_pack(
    state: State<'_, SharedState>,
    pack_id: String,
    name: String,
) -> AppResult<InstalledPack> {
    let installed = {
        let conn = state.db.lock();
        require_installed_pack(&conn, &pack_id)?
    };
    ensure_pack_not_review_locked(&installed)?;
    if installed.origin != "local" {
        return Err(AppError::msg(
            "Only locally-created or imported packs can be renamed",
        ));
    }

    let vault = state.vault_path();
    let updated = hub::rename_pack_folder(&vault, &installed.local_path, &name)?;
    finish_local_pack_identity_change(state.inner(), &installed, updated)
}

async fn hub_message_context(state: &SharedState) -> AppResult<(AppSettings, String)> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(state, &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to view Hub messages"))?;
    Ok((settings, token))
}

#[tauri::command]
pub async fn hub_list_messages(
    state: State<'_, SharedState>,
    filter: String,
    cursor: Option<String>,
) -> AppResult<hub::HubMessagePage> {
    let (settings, token) = hub_message_context(state.inner()).await?;
    hub::list_messages_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        &filter,
        cursor.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn hub_unread_message_count(
    state: State<'_, SharedState>,
) -> AppResult<hub::UnreadCount> {
    let (settings, token) = hub_message_context(state.inner()).await?;
    hub::unread_count_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
    )
    .await
}

async fn mutate_hub_message(
    state: &SharedState,
    method: reqwest::Method,
    path: &str,
) -> AppResult<()> {
    let (settings, token) = hub_message_context(state).await?;
    hub::mutate_message_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        method,
        path,
    )
    .await
}

#[tauri::command]
pub async fn hub_mark_message_read(
    state: State<'_, SharedState>,
    message_id: String,
) -> AppResult<()> {
    mutate_hub_message(
        state.inner(),
        reqwest::Method::PATCH,
        &format!("/{}/read", message_id),
    )
    .await
}

#[tauri::command]
pub async fn hub_mark_all_messages_read(state: State<'_, SharedState>) -> AppResult<()> {
    mutate_hub_message(state.inner(), reqwest::Method::POST, "/read-all").await
}

#[tauri::command]
pub async fn hub_delete_message(
    state: State<'_, SharedState>,
    message_id: String,
) -> AppResult<()> {
    mutate_hub_message(
        state.inner(),
        reqwest::Method::DELETE,
        &format!("/{}", message_id),
    )
    .await
}

#[tauri::command]
pub async fn hub_delete_read_messages(state: State<'_, SharedState>) -> AppResult<()> {
    mutate_hub_message(state.inner(), reqwest::Method::DELETE, "/read").await
}

async fn ensure_hub_access(
    state: &SharedState,
    settings: &AppSettings,
    force_refresh: bool,
) -> AppResult<Option<String>> {
    let _refresh_guard = state.hub_auth_refresh.lock().await;
    let session = state.hub_auth.lock().clone();
    let session = match session {
        Some(session) => session,
        None => {
            let Some(refresh) = load_refresh_token(state) else {
                return Ok(None);
            };
            let restored = match hub::refresh_remote(
                &settings.hub_base_url,
                settings.effective_proxy_url(),
                &refresh,
            )
            .await
            {
                Ok(value) => value,
                Err(error) => {
                    // Only a definitive rejection (401: the refresh token is
                    // actually invalid/expired) should sign the user out.
                    // Anything else — offline at launch, Hub briefly down,
                    // a timeout — is transient, and wiping the stored
                    // refresh token here would silently force a fresh login
                    // on every relaunch that happens to race the network.
                    if error.is_unauthorized() {
                        crate::nest_debug!(
                            "hub",
                            "stored refresh token rejected, clearing it: {error}"
                        );
                        clear_refresh_token(state);
                    } else {
                        crate::nest_debug!(
                            "hub",
                            "session restore failed, keeping stored refresh token for retry: {error}"
                        );
                    }
                    return Ok(None);
                }
            };
            // The Hub rotates refresh tokens on every use — the one just
            // exchanged above is now revoked server-side, so `restored`
            // carries a brand-new one that must be persisted immediately.
            // Skipping this meant every cold start silently burned the
            // stored token without saving its replacement, so only the
            // *first* relaunch after login ever worked — the next one
            // presented an already-revoked token and got signed out.
            store_refresh_token(state, &restored.refresh_token);
            *state.hub_auth.lock() = Some(restored.clone());
            restored
        }
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if !force_refresh && session.expires_at_epoch > now + 30 {
        return Ok(Some(session.access_token));
    }
    let refreshed = match hub::refresh_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &session.refresh_token,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            *state.hub_auth.lock() = None;
            if error.is_unauthorized() {
                crate::nest_debug!("hub", "refresh token rejected, clearing it: {error}");
                clear_refresh_token(state);
            } else {
                crate::nest_debug!(
                    "hub",
                    "token refresh failed, keeping stored refresh token for retry: {error}"
                );
            }
            return Ok(None);
        }
    };
    store_refresh_token(state, &refreshed.refresh_token);
    let token = refreshed.access_token.clone();
    *state.hub_auth.lock() = Some(refreshed);
    Ok(Some(token))
}

#[cfg(test)]
mod publishing_origin_tests {
    use super::*;

    fn installed(origin: &str) -> db::InstalledPack {
        db::InstalledPack {
            pack_id: "sample".into(),
            name: "Sample".into(),
            local_path: "sample".into(),
            version: "1.0.0".into(),
            patch_revision: 0,
            last_synced: None,
            active: true,
            origin: origin.into(),
            owner_id: None,
            description: String::new(),
            pending_version: None,
            pending_request_type: None,
            pending_patch_revision: None,
            pending_request_id: None,
            publish_review_status: None,
            publish_review_created_at: None,
            pending_can_cancel: false,
            pending_submitter_id: None,
            pending_submitter_name: None,
        }
    }

    #[test]
    fn local_and_registry_packs_are_publishable() {
        assert!(ensure_pack_publishable(&installed("local")).is_ok());
        assert!(ensure_pack_publishable(&installed("registry")).is_ok());
        for origin in ["bundled", "unknown"] {
            assert!(ensure_pack_publishable(&installed(origin)).is_err());
        }
    }

    #[test]
    fn pending_review_locks_mutations_but_approved_merge_state_does_not() {
        let mut pack = installed("local");
        pack.publish_review_status = Some("pending".into());
        assert!(ensure_pack_not_review_locked(&pack).is_err());

        pack.publish_review_status = Some("approved_awaiting_merge".into());
        assert!(ensure_pack_not_review_locked(&pack).is_ok());
    }
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

#[cfg(test)]
mod pack_install_conflict_tests {
    use super::*;

    #[test]
    fn local_pack_name_conflicts_but_registry_pack_does_not() {
        let root =
            std::env::temp_dir().join(format!("nest-conflict-test-{}", uuid::Uuid::new_v4()));
        let conn = db::open_db(&root.join("test.db")).unwrap();
        db::upsert_sync_state(
            &conn,
            db::SyncStateUpsert {
                pack_id: "my-local-copy",
                name: "Team Handbook",
                version: "1.0.0",
                local_path: "my-local-copy",
                origin: "local",
                owner_id: None,
                description: "",
                patch_revision: 0,
            },
        )
        .unwrap();
        db::upsert_sync_state(
            &conn,
            db::SyncStateUpsert {
                pack_id: "downloaded",
                name: "Downloaded",
                version: "1.0.0",
                local_path: "downloaded",
                origin: "registry",
                owner_id: None,
                description: "",
                patch_revision: 0,
            },
        )
        .unwrap();

        let conflict = local_download_conflict(&conn, "team-handbook", " Team Handbook ").unwrap();
        assert_eq!(
            conflict.as_ref().map(|pack| pack.pack_id.as_str()),
            Some("my-local-copy")
        );
        assert!(
            local_download_conflict(&conn, "team-handbook", "team handbook")
                .unwrap()
                .is_none()
        );
        assert!(local_download_conflict(&conn, "downloaded", "Downloaded")
            .unwrap()
            .is_none());
        drop(conn);
        let _ = fs::remove_dir_all(root);
    }
}
