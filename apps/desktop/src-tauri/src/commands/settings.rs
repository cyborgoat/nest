//! App settings, including the knowledge-directory migration flow (moving
//! the vault root, or discarding it and reseeding the bundled defaults).

use super::copy_directory_exact;
use crate::db::{self, AppSettings, InstalledPack};
use crate::error::{AppError, AppResult};
use crate::indexing;
use crate::state::SharedState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

#[tauri::command]
pub fn settings_get(state: State<'_, SharedState>) -> AppResult<AppSettings> {
    let mut settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    settings.resolved_knowledge_dir = state.vault_path().display().to_string();
    Ok(settings)
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultChangeMode {
    Move,
    DeleteAndSeedDefaults,
}

#[derive(Debug, Serialize)]
pub struct VaultChangePreview {
    current_path: String,
    target_path: String,
    managed_pack_count: usize,
}

#[derive(Debug, Serialize)]
pub struct VaultChangeResult {
    settings: AppSettings,
    cleanup_warning: Option<String>,
}

fn resolve_vault_change_target(state: &SharedState, knowledge_dir: &str) -> AppResult<PathBuf> {
    let target = crate::state::resolve_knowledge_dir(&state.app_data_dir, knowledge_dir.trim());
    if !target.is_absolute()
        || target
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(AppError::msg(
            "Knowledge directory must be an absolute path without parent traversal",
        ));
    }
    Ok(target)
}

fn validate_vault_change(current: &Path, target: &Path) -> AppResult<()> {
    if current == target {
        return Err(AppError::msg(
            "This is already the active knowledge directory",
        ));
    }
    if target.starts_with(current) || current.starts_with(target) {
        return Err(AppError::msg(
            "The old and new knowledge directories cannot contain one another",
        ));
    }
    if target.exists() {
        if !target.is_dir() {
            return Err(AppError::msg(
                "The selected knowledge directory is not a folder",
            ));
        }
        if fs::read_dir(target)?.next().is_some() {
            return Err(AppError::msg("The new knowledge directory must be empty"));
        }
    }
    Ok(())
}

fn managed_pack_directories(
    state: &SharedState,
    current: &Path,
) -> AppResult<Vec<(InstalledPack, PathBuf)>> {
    let installed = {
        let conn = state.db.lock();
        db::list_sync_state(&conn)?
    };
    let mut result = Vec::new();
    for pack in installed {
        let relative = Path::new(&pack.local_path);
        if relative.components().count() != 1
            || !matches!(relative.components().next(), Some(Component::Normal(_)))
        {
            return Err(AppError::msg(format!(
                "Pack “{}” has an unsafe local path",
                pack.name
            )));
        }
        let source = current.join(relative);
        if source.is_dir() {
            result.push((pack, source));
        }
    }
    Ok(result)
}

fn verify_directory_copy(source: &Path, destination: &Path) -> AppResult<()> {
    for entry in walkdir::WalkDir::new(source) {
        let entry = entry.map_err(|error| AppError::msg(error.to_string()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let relative = path
            .strip_prefix(source)
            .map_err(|error| AppError::msg(error.to_string()))?;
        let copied = destination.join(relative);
        if !copied.is_file() || fs::read(path)? != fs::read(&copied)? {
            return Err(AppError::msg(format!(
                "Could not verify the migrated copy of {}",
                relative.display()
            )));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn settings_preview_knowledge_dir(
    state: State<'_, SharedState>,
    knowledge_dir: String,
) -> AppResult<VaultChangePreview> {
    let current = state.vault_path();
    let target = resolve_vault_change_target(state.inner(), &knowledge_dir)?;
    validate_vault_change(&current, &target)?;
    let managed_pack_count = managed_pack_directories(state.inner(), &current)?.len();
    Ok(VaultChangePreview {
        current_path: current.display().to_string(),
        target_path: target.display().to_string(),
        managed_pack_count,
    })
}

#[tauri::command]
pub fn settings_change_knowledge_dir(
    state: State<'_, SharedState>,
    knowledge_dir: String,
    mode: VaultChangeMode,
) -> AppResult<VaultChangeResult> {
    let current = state.vault_path();
    let target = resolve_vault_change_target(state.inner(), &knowledge_dir)?;
    validate_vault_change(&current, &target)?;
    let all_installed = {
        let conn = state.db.lock();
        db::list_sync_state(&conn)?
    };
    let managed = managed_pack_directories(state.inner(), &current)?;
    let parent = target
        .parent()
        .ok_or_else(|| AppError::msg("The knowledge directory needs a parent folder"))?;
    fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".nest-vault-migration-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging)?;

    let prepared = (|| -> AppResult<()> {
        match mode {
            VaultChangeMode::Move => {
                for (pack, source) in &managed {
                    let destination = staging.join(&pack.local_path);
                    copy_directory_exact(source, &destination)?;
                    verify_directory_copy(source, &destination)?;
                }
            }
            VaultChangeMode::DeleteAndSeedDefaults => {
                crate::default_pack::write_fresh_defaults(&staging)?;
            }
        }
        Ok(())
    })();
    if let Err(error) = prepared {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if target.exists() {
        fs::remove_dir(&target)?;
    }
    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error.into());
    }

    let mut settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    settings.knowledge_dir = knowledge_dir.trim().to_string();
    settings.resolved_knowledge_dir = target.display().to_string();
    let mut cleanup_failures = Vec::new();
    if let Err(error) = (|| -> AppResult<()> {
        {
            let mut conn = state.db.lock();
            let transaction = conn.transaction()?;
            db::save_settings(&transaction, &settings)?;
            if matches!(mode, VaultChangeMode::DeleteAndSeedDefaults) {
                for pack in &all_installed {
                    db::purge_path_data(&transaction, &pack.local_path)?;
                }
                crate::default_pack::seed_fresh_defaults(&transaction, &target)?;
            }
            transaction.commit()?;
        }
        state.set_vault_path(target.clone())?;
        Ok(())
    })() {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }

    if matches!(mode, VaultChangeMode::DeleteAndSeedDefaults) {
        let conn = state.db.lock();
        if let Err(error) =
            crate::default_pack::ensure_default_snapshots(&conn, &state.app_data_dir, &target)
        {
            cleanup_failures.push(format!("default-pack snapshots: {error}"));
        }
    }
    for (pack, source) in &managed {
        if let Err(error) = fs::remove_dir_all(source) {
            cleanup_failures.push(format!("{}: {error}", pack.name));
        }
    }
    if matches!(mode, VaultChangeMode::DeleteAndSeedDefaults) {
        for pack in &all_installed {
            let _ = fs::remove_dir_all(state.app_data_dir.join("snapshots").join(&pack.pack_id));
        }
    }
    let _ = fs::remove_dir(&current);
    indexing::schedule(state.inner())?;

    Ok(VaultChangeResult {
        settings,
        cleanup_warning: (!cleanup_failures.is_empty()).then(|| {
            format!(
                "The new vault is active, but some old pack folders could not be removed: {}",
                cleanup_failures.join("; ")
            )
        }),
    })
}

#[tauri::command]
pub async fn settings_set(
    state: State<'_, SharedState>,
    mut settings: AppSettings,
) -> AppResult<()> {
    settings.normalize_llm_configuration();
    settings.knowledge_dir = settings.knowledge_dir.trim().to_string();
    settings.hub_base_url = settings
        .hub_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    settings.proxy_url = settings.proxy_url.trim().to_string();
    if !settings.hub_base_url.is_empty() {
        validate_http_base_url("Hub URL", &settings.hub_base_url)?;
    }
    if !settings.llm_base_url.is_empty() {
        validate_http_base_url("LLM Base URL", &settings.llm_base_url)?;
    }
    if settings.proxy_enabled {
        crate::http::validate_proxy_url(&settings.proxy_url)?;
    }

    let resolved =
        crate::state::resolve_knowledge_dir(&state.app_data_dir, &settings.knowledge_dir);
    if !resolved.is_absolute() {
        return Err(AppError::msg(
            "Knowledge directory must be an absolute path (or leave empty for the default)",
        ));
    }

    let vault_changed = resolved != state.vault_path();
    if vault_changed {
        return Err(AppError::msg(
            "Use the knowledge-directory migration prompt to change the vault location",
        ));
    }

    settings.resolved_knowledge_dir = resolved.display().to_string();

    {
        let conn = state.db.lock();
        db::save_settings(&conn, &settings)?;
    }

    Ok(())
}

/// Only called with a non-empty value — hub_base_url is optional overall.
fn validate_http_base_url(label: &str, value: &str) -> AppResult<()> {
    let url = reqwest::Url::parse(value)
        .map_err(|e| AppError::msg(format!("{label} is invalid: {e}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::msg(format!("{label} must use http or https")));
    }
    if url.host_str().is_none() {
        return Err(AppError::msg(format!("{label} must include a host")));
    }
    Ok(())
}

#[cfg(test)]
mod vault_change_helpers_tests {
    use super::*;

    #[test]
    fn target_must_be_separate_and_empty() {
        let root =
            std::env::temp_dir().join(format!("nest-vault-change-test-{}", uuid::Uuid::new_v4()));
        let current = root.join("current");
        let target = root.join("target");
        fs::create_dir_all(&current).unwrap();
        fs::create_dir_all(&target).unwrap();
        assert!(validate_vault_change(&current, &target).is_ok());
        assert!(validate_vault_change(&current, &current.join("nested")).is_err());
        fs::write(target.join("existing.txt"), b"occupied").unwrap();
        assert!(validate_vault_change(&current, &target).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migration_copy_preserves_and_verifies_all_regular_files() {
        let root =
            std::env::temp_dir().join(format!("nest-vault-copy-test-{}", uuid::Uuid::new_v4()));
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(source.join("assets")).unwrap();
        fs::write(source.join("README.md"), b"# Pack").unwrap();
        fs::write(source.join("assets").join("raw.bin"), [0_u8, 1, 2, 3]).unwrap();

        copy_directory_exact(&source, &destination).unwrap();
        verify_directory_copy(&source, &destination).unwrap();
        assert_eq!(
            fs::read(destination.join("assets").join("raw.bin")).unwrap(),
            [0_u8, 1, 2, 3]
        );
        let _ = fs::remove_dir_all(root);
    }
}
