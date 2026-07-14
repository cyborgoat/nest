use crate::db::{
    self, AppSettings, ChatMessage, ChatSession, IndexStatus, InstalledPack, PackMeta,
};
use crate::error::{AppError, AppResult};
use crate::hub;
use crate::indexer;
use crate::llm;
use crate::retrieval;
use crate::state::SharedState;
use crate::vault::{self, TreeNode};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn vault_list_tree(state: State<'_, SharedState>) -> AppResult<Vec<TreeNode>> {
    vault::list_tree(&state.vault_root)
}

#[tauri::command]
pub fn vault_read_file(state: State<'_, SharedState>, path: String) -> AppResult<String> {
    vault::read_file(&state.vault_root, &path)
}

#[tauri::command]
pub fn settings_get(state: State<'_, SharedState>) -> AppResult<AppSettings> {
    let conn = state.db.lock();
    db::get_settings(&conn)
}

#[tauri::command]
pub fn settings_set(state: State<'_, SharedState>, settings: AppSettings) -> AppResult<()> {
    let conn = state.db.lock();
    db::save_settings(&conn, &settings)
}

#[tauri::command]
pub async fn settings_test_connection(state: State<'_, SharedState>) -> AppResult<String> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    llm::test_connection(&settings).await
}

#[tauri::command]
pub fn index_status(state: State<'_, SharedState>) -> AppResult<IndexStatus> {
    let conn = state.db.lock();
    db::get_index_status(&conn, state.indexing())
}

#[tauri::command]
pub async fn index_rebuild(state: State<'_, SharedState>) -> AppResult<IndexStatus> {
    if state.indexing() {
        return Err(AppError::msg("Indexing already in progress"));
    }
    state.set_indexing(true);
    let result = (|| {
        let pending = indexer::collect_pending_chunks(&state.vault_root)?;
        let conn = state.db.lock();
        indexer::persist_chunks(&conn, &pending)?;
        db::get_index_status(&conn, false)
    })();
    state.set_indexing(false);
    result
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
pub fn chat_list_sessions(state: State<'_, SharedState>) -> AppResult<Vec<ChatSession>> {
    let conn = state.db.lock();
    db::list_sessions(&conn)
}

#[tauri::command]
pub fn chat_list_messages(
    state: State<'_, SharedState>,
    session_id: String,
) -> AppResult<Vec<ChatMessage>> {
    let conn = state.db.lock();
    db::list_messages(&conn, &session_id)
}

#[tauri::command]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, SharedState>,
    session_id: String,
    query: String,
    scope_paths: Option<Vec<String>>,
    stream_event: String,
) -> AppResult<ChatMessage> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let scope = scope_paths.unwrap_or_default();

    {
        let conn = state.db.lock();
        db::add_message(&conn, &session_id, "user", &query, None)?;
    }

    let citations = {
        let conn = state.db.lock();
        retrieval::retrieve(&conn, &query, &scope, settings.top_k)?
    };

    let (system, user) = retrieval::build_prompt(&query, &citations);
    let answer = match llm::stream_chat(
        &app,
        &stream_event,
        &settings,
        &system,
        &user,
        citations.clone(),
    )
    .await
    {
        Ok(text) => text,
        Err(e) => {
            let _ = app.emit(
                &stream_event,
                llm::ChatStreamEvent::Error {
                    message: e.to_string(),
                },
            );
            return Err(e);
        }
    };

    let message = {
        let conn = state.db.lock();
        db::add_message(
            &conn,
            &session_id,
            "assistant",
            &answer,
            Some(&citations),
        )?
    };

    let _ = app.emit(
        &stream_event,
        llm::ChatStreamEvent::Done {
            message_id: message.id.clone(),
        },
    );

    Ok(message)
}

#[tauri::command]
pub async fn hub_list_packs(state: State<'_, SharedState>) -> AppResult<Vec<PackMeta>> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    match hub::list_packs_remote(&settings.hub_base_url).await {
        Ok(packs) if !packs.is_empty() => Ok(packs),
        _ => hub::list_packs_fixture(&state.fixtures_root),
    }
}

#[tauri::command]
pub fn hub_list_installed(state: State<'_, SharedState>) -> AppResult<Vec<InstalledPack>> {
    let conn = state.db.lock();
    let mut installed = db::list_sync_state(&conn)?;
    // Only keep packs whose vault directory still exists.
    installed.retain(|p| state.vault_root.join(&p.local_path).is_dir());
    Ok(installed)
}

#[tauri::command]
pub fn hub_remove_pack(state: State<'_, SharedState>, pack_id: String) -> AppResult<()> {
    let local_path = {
        let conn = state.db.lock();
        if let Some(installed) = db::get_sync_state(&conn, &pack_id)? {
            installed.local_path
        } else {
            // Fallback: pack_id often matches top-level folder name.
            pack_id.clone()
        }
    };

    vault::remove_pack(&state.vault_root, &local_path)?;
    let conn = state.db.lock();
    db::purge_path_data(&conn, &local_path)?;
    // Also purge by pack_id in case local_path differed.
    if local_path != pack_id {
        db::purge_path_data(&conn, &pack_id)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hub_download_pack(
    state: State<'_, SharedState>,
    pack_id: String,
) -> AppResult<IndexStatus> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let packs = match hub::list_packs_remote(&settings.hub_base_url).await {
        Ok(p) if !p.is_empty() => p,
        _ => hub::list_packs_fixture(&state.fixtures_root)?,
    };
    let pack = packs
        .into_iter()
        .find(|p| p.id == pack_id)
        .ok_or_else(|| AppError::msg(format!("Unknown pack: {pack_id}")))?;

    if hub::download_pack_remote(&settings.hub_base_url, &pack, &state.vault_root)
        .await
        .is_err()
    {
        hub::import_pack_fixture(&state.fixtures_root, &pack, &state.vault_root)?;
    }

    {
        let conn = state.db.lock();
        hub::record_sync(&conn, &pack)?;
    }

    index_rebuild(state).await
}

#[tauri::command]
pub fn hub_import_demo_pack(state: State<'_, SharedState>) -> AppResult<()> {
    let packs = hub::list_packs_fixture(&state.fixtures_root)?;
    for pack in packs {
        hub::import_pack_fixture(&state.fixtures_root, &pack, &state.vault_root)?;
        let conn = state.db.lock();
        hub::record_sync(&conn, &pack)?;
    }
    Ok(())
}
