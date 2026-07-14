use crate::db::{
    self, AppSettings, ChatMessage, ChatSession, IndexStatus, InstalledPack, PackMeta,
};
use crate::embeddings;
use crate::error::{AppError, AppResult};
use crate::hub;
use crate::indexer;
use crate::llm;
use crate::state::SharedState;
use crate::vector_store::{self, KnowledgeChunk};
use crate::vault::{self, TreeNode};
use crate::agent;
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
pub fn settings_set(state: State<'_, SharedState>, mut settings: AppSettings) -> AppResult<()> {
    // Embedding model is fixed locally — not user-configurable.
    settings.embedding_model = embeddings::DEFAULT_EMBEDDING_MODEL.into();
    let conn = state.db.lock();
    db::save_settings(&conn, &settings)
}

#[tauri::command]
pub async fn settings_test_llm(state: State<'_, SharedState>) -> AppResult<String> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    llm::test_connection(&settings).await
}

#[tauri::command]
pub async fn settings_test_hub(state: State<'_, SharedState>) -> AppResult<String> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let status = hub::check_hub_status(&settings.hub_base_url).await;
    if status.online {
        Ok(format!("Knowledge Hub OK ({})", status.hub_base_url))
    } else {
        Err(AppError::msg(
            status
                .message
                .unwrap_or_else(|| "Knowledge Hub is not accessible".into()),
        ))
    }
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

    let result = async {
        let settings = {
            let conn = state.db.lock();
            db::get_settings(&conn)?
        };

        {
            let conn = state.db.lock();
            db::set_index_meta(&conn, 0, 0, Some("Collecting Markdown…"))?;
        }

        let pending = indexer::collect_pending_chunks(&state.vault_root)?;

        {
            let conn = state.db.lock();
            db::set_index_meta(
                &conn,
                0,
                pending.len() as u32,
                Some("Building FTS index…"),
            )?;
            indexer::persist_chunks(&conn, &pending)?;
            db::set_index_meta(
                &conn,
                {
                    let mut files = std::collections::HashSet::new();
                    for (_, path, _, _, _, _) in &pending {
                        files.insert(path.clone());
                    }
                    files.len() as u32
                },
                pending.len() as u32,
                Some("Loading FastEmbed model (may download on first run)…"),
            )?;
        }

        let model = embeddings::load_embedding_model(&settings.embedding_model)?;
        let chunks: Vec<KnowledgeChunk> = pending
            .iter()
            .map(|(id, file_path, title, content, _, _)| KnowledgeChunk {
                id: id.clone(),
                file_path: file_path.clone(),
                title: title.clone(),
                content: content.clone(),
            })
            .collect();

        {
            let conn = state.db.lock();
            let file_count = {
                let mut files = std::collections::HashSet::new();
                for c in &chunks {
                    files.insert(c.file_path.clone());
                }
                files.len() as u32
            };
            db::set_index_meta(
                &conn,
                file_count,
                chunks.len() as u32,
                Some("Embedding chunks into local vector store…"),
            )?;
        }

        vector_store::rebuild_vector_index(&state.app_data_dir, model, chunks).await?;

        let conn = state.db.lock();
        let file_count = {
            let mut files = std::collections::HashSet::new();
            for (_, path, _, _, _, _) in &pending {
                files.insert(path.clone());
            }
            files.len() as u32
        };
        db::set_index_meta(
            &conn,
            file_count,
            pending.len() as u32,
            Some("Local FTS + FastEmbed vector index ready"),
        )?;
        db::get_index_status(&conn, false)
    }
    .await;

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
pub async fn chat_generate_title(
    state: State<'_, SharedState>,
    session_id: String,
) -> AppResult<ChatSession> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let state_clone = state.inner().clone();
    let sid = session_id.clone();
    crate::title::generate_title_for_session(
        &settings,
        &session_id,
        || {
            let conn = state_clone.db.lock();
            crate::title::load_session_turns(&conn, &sid)
        },
        |title| {
            let conn = state_clone.db.lock();
            db::set_session_title_llm(&conn, &sid, title)
        },
    )
    .await
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
    for msg in &mut messages {
        if let Some(refs) = msg.citations.as_mut() {
            refs.retain(|c| state.vault_root.join(&c.file_path).is_file());
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
    scope_paths: Option<Vec<String>>,
    stream_event: String,
) -> AppResult<ChatMessage> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let scope = scope_paths.unwrap_or_default();
    let app_data_dir = state.app_data_dir.clone();

    // Persist the user turn first for durable history / UI refresh.
    {
        let conn = state.db.lock();
        db::add_message(&conn, &session_id, "user", &query, None)?;
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
        crate::memory::messages_to_rig_history(&msgs)
    };

    crate::nest_debug!(
        "chat",
        "chat_send session={session_id} query_len={} scope={:?}",
        query.len(),
        scope
    );

    let result = match agent::run_agent_chat(
        &app,
        state.inner().clone(),
        app_data_dir,
        &settings,
        &session_id,
        &query,
        scope,
        &stream_event,
        prior,
    )
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
        "chat_send ok answer_len={} citations={} cancelled={}",
        result.answer.len(),
        result.citations.len(),
        result.cancelled
    );

    let answer = if result.cancelled && !result.answer.trim().is_empty() {
        format!("{}\n\n_(stopped)_", result.answer.trim_end())
    } else {
        result.answer
    };

    let message = {
        let conn = state.db.lock();
        db::add_message(
            &conn,
            &session_id,
            "assistant",
            &answer,
            Some(&result.citations),
        )?
    };

    let _ = app.emit(
        &stream_event,
        llm::ChatStreamEvent::Done {
            message_id: message.id.clone(),
        },
    );

    // Best-effort title naming — do not block returning the assistant message.
    if !result.cancelled {
        let state_clone = state.inner().clone();
        let sid = session_id.clone();
        let settings_for_title = settings.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::title::maybe_auto_title_after_reply(
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
        });
    }

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
    Ok(hub::check_hub_status(&settings.hub_base_url).await)
}

#[tauri::command]
pub async fn hub_list_packs(state: State<'_, SharedState>) -> AppResult<Vec<PackMeta>> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    hub::list_packs_remote(&settings.hub_base_url).await
}

#[tauri::command]
pub fn hub_list_installed(state: State<'_, SharedState>) -> AppResult<Vec<InstalledPack>> {
    let conn = state.db.lock();
    let mut installed = db::list_sync_state(&conn)?;
    // Require real Markdown content — empty leftovers must not count as installed.
    installed.retain(|p| pack_has_markdown(&state.vault_root, &p.local_path));
    Ok(installed)
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
pub async fn hub_remove_pack(
    state: State<'_, SharedState>,
    pack_id: String,
) -> AppResult<IndexStatus> {
    let local_path = {
        let conn = state.db.lock();
        if let Some(installed) = db::get_sync_state(&conn, &pack_id)? {
            installed.local_path
        } else {
            pack_id.clone()
        }
    };

    crate::nest_debug!(
        "hub",
        "remove_pack id={pack_id} local_path={local_path}"
    );

    vault::remove_pack(&state.vault_root, &local_path)?;
    vault::prune_empty_dirs(&state.vault_root)?;
    {
        let conn = state.db.lock();
        db::purge_path_data(&conn, &local_path)?;
        if local_path != pack_id {
            db::purge_path_data(&conn, &pack_id)?;
        }
    }

    // Rebuild so FastEmbed vectors stay in sync with the vault (purge only clears FTS/SQL).
    index_rebuild(state).await
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
    let packs = hub::list_packs_remote(&settings.hub_base_url).await?;
    let pack = packs
        .into_iter()
        .find(|p| p.id == pack_id)
        .ok_or_else(|| AppError::msg(format!("Unknown pack: {pack_id}")))?;

    hub::download_pack_remote(&settings.hub_base_url, &pack, &state.vault_root).await?;

    {
        let conn = state.db.lock();
        hub::record_sync(&conn, &pack)?;
    }

    index_rebuild(state).await
}

#[tauri::command]
pub async fn hub_import_local_pack(
    state: State<'_, SharedState>,
    source_path: String,
) -> AppResult<IndexStatus> {
    let source = std::path::PathBuf::from(source_path.trim());
    crate::nest_debug!(
        "hub",
        "import_local_pack source={}",
        source.display()
    );

    let pack = hub::import_local_pack(&source, &state.vault_root)?;
    {
        let conn = state.db.lock();
        hub::record_sync(&conn, &pack)?;
    }

    index_rebuild(state).await
}
