use crate::db::{self, IndexStatus};
use crate::embeddings;
use crate::error::AppResult;
use crate::indexer;
use crate::state::SharedState;
use crate::vector_store::{self, KnowledgeChunk};
use std::time::Duration;

pub fn status(state: &SharedState) -> AppResult<IndexStatus> {
    let conn = state.db.lock();
    db::get_index_status(&conn, state.indexing())
}

async fn rebuild(state: &SharedState) -> AppResult<IndexStatus> {
    {
        let conn = state.db.lock();
        db::set_index_progress(&conn, 0, 0, Some("Collecting Markdown…"))?;
    }

    let pending = indexer::collect_pending_chunks(&state.vault_path())?;
    let file_count = pending
        .iter()
        .map(|chunk| &chunk.file_path)
        .collect::<std::collections::HashSet<_>>()
        .len() as u32;

    {
        let conn = state.db.lock();
        db::set_index_progress(&conn, 0, pending.len() as u32, Some("Building FTS index…"))?;
        indexer::persist_chunks(&conn, &pending)?;
        db::set_index_progress(
            &conn,
            file_count,
            pending.len() as u32,
            Some("Loading embedding model…"),
        )?;
    }

    let model = embeddings::load_embedding_model()?;
    let chunks = pending
        .iter()
        .map(|chunk| KnowledgeChunk {
            id: chunk.id.clone(),
            file_path: chunk.file_path.clone(),
            title: chunk.title.clone(),
            content: chunk.content.clone(),
        })
        .collect::<Vec<_>>();

    {
        let conn = state.db.lock();
        db::set_index_progress(
            &conn,
            file_count,
            chunks.len() as u32,
            Some("Embedding chunks into local vector store…"),
        )?;
    }

    vector_store::rebuild_vector_index(&state.app_data_dir, model, chunks).await?;

    let conn = state.db.lock();
    db::set_index_complete(
        &conn,
        file_count,
        pending.len() as u32,
        "Local FTS + FastEmbed vector index ready",
    )?;
    db::get_index_status(&conn, false)
}

/// Queue a coalesced background rebuild. Pack filesystem operations are already
/// complete when this is called, so model loading never blocks their dialogs.
pub fn schedule(state: &SharedState) -> AppResult<IndexStatus> {
    schedule_generation(state);
    status(state)
}

fn schedule_generation(state: &SharedState) -> u64 {
    let generation = state.request_index_rebuild();
    if state.try_begin_indexing() {
        let state_clone = state.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let generation = state_clone.requested_index_generation();
                let succeeded = match rebuild(&state_clone).await {
                    Ok(_) => true,
                    Err(error) => {
                        let conn = state_clone.db.lock();
                        let _ =
                            db::set_index_message(&conn, &format!("Index update failed: {error}"));
                        false
                    }
                };
                state_clone.mark_index_generation_complete(generation, succeeded);
                state_clone.set_indexing(false);

                if state_clone.requested_index_generation() == state_clone.indexed_generation()
                    || !state_clone.try_begin_indexing()
                {
                    break;
                }
            }
        });
    }
    generation
}

pub async fn schedule_and_wait(state: &SharedState, timeout: Duration) -> AppResult<IndexStatus> {
    let generation = schedule_generation(state);
    tokio::time::timeout(timeout, async {
        loop {
            if state.indexed_generation() >= generation {
                if state.successful_index_generation() >= generation {
                    return status(state);
                }
                return Err(crate::error::AppError::msg(
                    "workspace_reindex_failed: index rebuild did not complete successfully",
                ));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .map_err(|_| crate::error::AppError::msg("workspace_reindex_timeout"))?
}
