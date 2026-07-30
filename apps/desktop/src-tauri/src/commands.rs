use crate::agent;
use crate::db::{
    self, AppSettings, ChatMessage, ChatSession, IndexStatus, InstalledPack, PackMeta,
};
use crate::error::{AppError, AppResult};
use crate::hub::{self, PackProject};
use crate::indexing;
use crate::llm;
use crate::state::SharedState;
use crate::vault::{self, TreeNode};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter, State};

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
    let vault = state.vault_path();
    vault::create_file(&vault, &path, initial_content.as_deref().unwrap_or(""))?;
    indexing::schedule(state.inner())?;
    Ok(())
}

#[tauri::command]
pub fn vault_create_folder(state: State<'_, SharedState>, path: String) -> AppResult<()> {
    let vault = state.vault_path();
    vault::create_folder(&vault, &path)?;
    Ok(())
}

#[tauri::command]
pub fn vault_delete_file(state: State<'_, SharedState>, path: String) -> AppResult<()> {
    let vault = state.vault_path();
    vault::delete_file(&vault, &path)?;
    indexing::schedule(state.inner())?;
    Ok(())
}

#[tauri::command]
pub fn vault_delete_folder(state: State<'_, SharedState>, path: String) -> AppResult<()> {
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
    let vault = state.vault_path();
    vault::rename_entry(&vault, &from, &to)?;
    indexing::schedule(state.inner())?;
    Ok(())
}

/// Look up an installed pack by id, or fail with a consistent error message.
/// Shared by every command that needs "the pack, or a clear error" before
/// doing anything else.
fn require_installed_pack(conn: &rusqlite::Connection, pack_id: &str) -> AppResult<InstalledPack> {
    let pack_id = pack_id.trim();
    db::get_sync_state(conn, pack_id)?
        .ok_or_else(|| AppError::msg(format!("Pack not installed: {pack_id}")))
}

#[derive(Debug, Clone, Serialize)]
pub struct PackInstallConflict {
    pack_id: String,
    name: String,
    local_path: String,
    version: String,
}

fn normalized_pack_name(value: &str) -> String {
    value.trim().to_lowercase()
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
    let (pack_dir, snapshot_dir, local_path) = pack_dirs(&state, &pack_id)?;
    let pack_relative = strip_pack_prefix(&local_path, &path)?;
    crate::snapshot::discard_file(&pack_dir, &snapshot_dir, &pack_relative)?;
    indexing::schedule(state.inner())?;
    Ok(())
}

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

fn copy_directory_exact(source: &Path, destination: &Path) -> AppResult<()> {
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

#[tauri::command]
pub fn index_status(state: State<'_, SharedState>) -> AppResult<IndexStatus> {
    indexing::status(state.inner())
}

#[tauri::command]
pub fn index_rebuild(state: State<'_, SharedState>) -> AppResult<IndexStatus> {
    indexing::schedule(state.inner())
}

#[tauri::command]
pub fn chat_create_session(
    state: State<'_, SharedState>,
    title: Option<String>,
) -> AppResult<ChatSession> {
    let conn = state.db.lock();
    db::create_session(&conn, title.as_deref().unwrap_or("New chat"))
}

#[tauri::command]
pub fn chat_get_or_create_initial_session(state: State<'_, SharedState>) -> AppResult<ChatSession> {
    let conn = state.db.lock();
    db::get_or_create_initial_session(&conn)
}

#[tauri::command]
pub fn chat_list_sessions(state: State<'_, SharedState>) -> AppResult<Vec<ChatSession>> {
    let conn = state.db.lock();
    db::list_sessions(&conn)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionPatch {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
}

#[tauri::command]
pub fn chat_update_session(
    state: State<'_, SharedState>,
    session_id: String,
    patch: ChatSessionPatch,
) -> AppResult<ChatSession> {
    let conn = state.db.lock();
    db::update_session(
        &conn,
        &session_id,
        db::ChatSessionUpdate {
            title: patch.title,
            pinned: patch.pinned,
            archived: patch.archived,
            title_source: None,
        },
    )
}

#[tauri::command]
pub fn chat_delete_session(state: State<'_, SharedState>, session_id: String) -> AppResult<()> {
    let conn = state.db.lock();
    db::delete_session(&conn, &session_id)
}

#[tauri::command]
pub fn chat_list_messages(
    state: State<'_, SharedState>,
    session_id: String,
) -> AppResult<Vec<ChatMessage>> {
    let mut messages = {
        let conn = state.db.lock();
        db::list_messages(&conn, &session_id)?
    };
    // Hide citations that point at removed vault files (packs deleted after the reply).
    let vault = state.vault_path();
    for msg in &mut messages {
        if let Some(refs) = msg.citations.as_mut() {
            refs.retain(|c| vault.join(&c.file_path).is_file());
            if refs.is_empty() {
                msg.citations = None;
            }
        }
    }
    Ok(messages)
}

#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, SharedState>,
    session_id: String,
    query: String,
    focus_paths: Option<Vec<String>>,
    stream_event: String,
) -> AppResult<ChatMessage> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let focus = focus_paths.unwrap_or_default();
    let app_data_dir = state.app_data_dir.clone();

    // Persist the user turn first for durable history / UI refresh.
    {
        let conn = state.db.lock();
        db::add_message(&conn, &session_id, "user", &query, None, None, None)?;
    }

    // Build prior turns for the agent, excluding the just-saved user message
    // so `stream_chat(query, …)` does not duplicate it.
    let prior = {
        let conn = state.db.lock();
        let mut msgs = db::list_messages(&conn, &session_id)?;
        if msgs
            .last()
            .map(|m| m.role == "user" && m.content == query)
            .unwrap_or(false)
        {
            msgs.pop();
        }
        crate::chat_history::messages_to_rig_history(&msgs)
    };

    crate::nest_debug!(
        "chat",
        "chat_send session={session_id} query_len={} focus={:?}",
        query.len(),
        focus
    );

    let result = match agent::run_agent_chat(agent::AgentChatRequest {
        app: app.clone(),
        state: state.inner().clone(),
        app_data_dir,
        settings: settings.clone(),
        session_id: session_id.clone(),
        query: query.clone(),
        focus_paths: focus,
        stream_event: stream_event.clone(),
        prior_history: prior,
    })
    .await
    {
        Ok(v) => v,
        Err(e) => {
            crate::nest_debug!("chat", "chat_send failed: {e}");
            // Soft-cancel: user stopped before any tokens arrived.
            if e.to_string() == "cancelled" {
                let _ = app.emit(
                    &stream_event,
                    llm::ChatStreamEvent::Done {
                        message_id: String::new(),
                    },
                );
                return Err(e);
            }
            let _ = app.emit(
                &stream_event,
                llm::ChatStreamEvent::Error {
                    message: e.to_string(),
                },
            );
            return Err(e);
        }
    };

    crate::nest_debug!(
        "chat",
        "chat_send ok answer_len={} citations={} thinking={}",
        result.answer.len(),
        result.citations.len(),
        result.thinking.is_some()
    );

    let answer = result.answer;

    let message = {
        let conn = state.db.lock();
        db::add_message(
            &conn,
            &session_id,
            "assistant",
            &answer,
            Some(&result.citations),
            result.thinking.as_deref(),
            result.thinking_seconds,
        )?
    };

    let _ = app.emit(
        &stream_event,
        llm::ChatStreamEvent::Done {
            message_id: message.id.clone(),
        },
    );

    // Best-effort title naming — do not block returning the assistant message.
    let state_clone = state.inner().clone();
    let sid = session_id.clone();
    let settings_for_title = settings.clone();
    let app_for_title = app.clone();
    tauri::async_runtime::spawn(async move {
        let updated = crate::title::maybe_auto_title_after_reply(
            &settings_for_title,
            &sid,
            || {
                let conn = state_clone.db.lock();
                crate::title::load_session_turns(&conn, &sid)
            },
            |title| {
                let conn = state_clone.db.lock();
                db::set_session_title_llm(&conn, &sid, title)
            },
        )
        .await;
        if let Some(session) = updated {
            let _ = app_for_title.emit("chat-session-updated", session);
        }
    });

    Ok(message)
}

#[tauri::command]
pub fn chat_cancel(state: State<'_, SharedState>) -> AppResult<()> {
    state.request_chat_cancel();
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
    vault::prune_empty_dirs(&vault)?;
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
pub async fn hub_download_pack(
    state: State<'_, SharedState>,
    pack_id: String,
    pack_name: String,
    version: Option<String>,
    owner_id: Option<String>,
    replace_local_pack_id: Option<String>,
    sync_patch: Option<bool>,
) -> AppResult<InstalledPack> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };

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
        let pack_dir = vault.join(&installed.local_path);
        let snapshot_dir = crate::snapshot::snapshot_root(
            &state.app_data_dir,
            &installed.pack_id,
            &installed.version,
        );
        if !crate::snapshot::compute_status(&pack_dir, &snapshot_dir)?.is_empty() {
            return Err(AppError::msg(
                "Commit or discard local Source Control changes before syncing a live patch",
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

    let staged_pack = staging.join(&pack.path);
    if !staged_pack.is_dir() {
        let _ = fs::remove_dir_all(&staging);
        return Err(AppError::msg(
            "The downloaded archive did not contain the expected pack folder",
        ));
    }
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
    if let Err(error) =
        crate::snapshot::write_snapshot(&state.app_data_dir, &pack.id, &pack.version, &target)
    {
        let _ = fs::remove_dir_all(&target);
        for (original, saved) in backups.iter().rev() {
            let _ = fs::rename(saved, original);
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
    if let Ok(entry) = keyring::Entry::new("com.cyborgoat.nest.hub", "active") {
        let _ = entry.set_password(&session.refresh_token);
    }
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
    if let Ok(entry) = keyring::Entry::new("com.cyborgoat.nest.hub", "active") {
        let _ = entry.set_password(&session.refresh_token);
    }
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
    if let Ok(entry) = keyring::Entry::new("com.cyborgoat.nest.hub", "active") {
        let _ = entry.delete_credential();
    }
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
    if let Ok(entry) = keyring::Entry::new("com.cyborgoat.nest.hub", "active") {
        let _ = entry.set_password(&session.refresh_token);
    }
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
) -> AppResult<hub::PublishRequest> {
    publish_pack(
        state.inner(),
        pack_id,
        PublishOperation::Release { version },
    )
    .await
}

#[tauri::command]
pub async fn hub_publish_live_patch(
    state: State<'_, SharedState>,
    pack_id: String,
    target_version: String,
) -> AppResult<hub::PublishRequest> {
    publish_pack(
        state.inner(),
        pack_id,
        PublishOperation::LivePatch { target_version },
    )
    .await
}

enum PublishOperation {
    Release { version: String },
    LivePatch { target_version: String },
}

impl PublishOperation {
    fn request_type(&self) -> &'static str {
        match self {
            Self::Release { .. } => "release",
            Self::LivePatch { .. } => "live_patch",
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
        PublishOperation::Release { .. } => {
            hub::publish_release_remote(
                &settings.hub_base_url,
                settings.effective_proxy_url(),
                token,
                pack,
                source_local_path,
                vault,
            )
            .await
        }
        PublishOperation::LivePatch { .. } => {
            hub::publish_live_patch_remote(
                &settings.hub_base_url,
                settings.effective_proxy_url(),
                token,
                pack,
                source_local_path,
                vault,
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
    let installed = {
        let conn = state.db.lock();
        require_installed_pack(&conn, &pack_id)?
    };
    ensure_pack_publishable(&installed)?;
    if let Some(pending_version) = &installed.pending_version {
        return Err(AppError::msg(format!(
            "{} already has a submission awaiting review (v{pending_version}). Wait for it to be approved or rejected before submitting again.",
            installed.name,
        )));
    }
    let vault = state.vault_path();
    let source_local_path = installed.local_path.clone();
    let pack = match &operation {
        PublishOperation::Release { version } => {
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
        PublishOperation::LivePatch { target_version } => {
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
            &request.id,
            &pack.version,
            Some(&request.created_at),
            &request.request_type,
            request.patch_revision,
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
            &remote.id,
            &remote.version,
            Some(&remote.created_at),
            &remote.request_type,
            remote.patch_revision,
        );
        return;
    }

    let Some(request_id) = &pack.pending_request_id else {
        return;
    };
    // We locally thought this pack still had a pending request; the Hub now
    // says it doesn't, so it just resolved. Learn the outcome to decide
    // whether to advance the version/snapshot baseline.
    let Ok(resolved) = hub::get_publish_request_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        token,
        request_id,
    )
    .await
    else {
        // Keep the local marker when the resolution cannot be confirmed.
        // A transient network/auth failure must never discard a merge action.
        return;
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
/// The working directory is deliberately untouched: any edits made after
/// submission become ordinary Source Control differences.
#[tauri::command]
pub async fn hub_merge_approved_pack(
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
    let snapshot_result = crate::snapshot::write_snapshot(
        &state.app_data_dir,
        &approved.id,
        &approved.version,
        &approved_dir,
    );
    if let Err(error) = snapshot_result {
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

/// Renames a local pack: its display name, id, and vault folder all change
/// together (the vault's invariant is folder name == id == display name for
/// local packs — see `hub::create_empty_pack`/`hub::rename_pack_folder`).
/// Downloaded (`registry`) packs, and bundled/unknown-origin ones, keep the
/// identity the hub already tracks — renaming those isn't offered at all.
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
    if installed.origin != "local" {
        return Err(AppError::msg(
            "Only locally-created or imported packs can be renamed",
        ));
    }

    let vault = state.vault_path();
    let updated = hub::rename_pack_folder(&vault, &installed.local_path, &name)?;
    crate::snapshot::rename_snapshot_root(&state.app_data_dir, &installed.pack_id, &updated.id)?;

    {
        let conn = state.db.lock();
        // The old path's indexed content is stale the instant the folder
        // moves; a fresh index run (below) repopulates it under the new
        // path. This must NOT be `purge_path_data` — that also deletes the
        // sync_state row we're about to update in place.
        db::purge_chunks_for_path(&conn, &installed.local_path)?;
        db::rename_sync_state_pack(&conn, &installed.pack_id, &updated.id, &updated.name)?;
    }
    indexing::schedule(state.inner())?;

    let conn = state.db.lock();
    db::get_sync_state(&conn, &updated.id)?
        .ok_or_else(|| AppError::msg("Renamed pack record was not saved"))
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
            let refresh = keyring::Entry::new("com.cyborgoat.nest.hub", "active")
                .ok()
                .and_then(|entry| entry.get_password().ok());
            let Some(refresh) = refresh else {
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
                Err(_) => {
                    if let Ok(entry) = keyring::Entry::new("com.cyborgoat.nest.hub", "active") {
                        let _ = entry.delete_credential();
                    }
                    return Ok(None);
                }
            };
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
        Err(_) => {
            *state.hub_auth.lock() = None;
            if let Ok(entry) = keyring::Entry::new("com.cyborgoat.nest.hub", "active") {
                let _ = entry.delete_credential();
            }
            return Ok(None);
        }
    };
    if let Ok(entry) = keyring::Entry::new("com.cyborgoat.nest.hub", "active") {
        let _ = entry.set_password(&refreshed.refresh_token);
    }
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
        assert!(local_download_conflict(&conn, "downloaded", "Downloaded")
            .unwrap()
            .is_none());
        drop(conn);
        let _ = fs::remove_dir_all(root);
    }
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
