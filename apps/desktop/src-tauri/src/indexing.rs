use crate::db::{self, IndexStatus};
use crate::embeddings::INDEX_EMBED_BATCH_SIZE;
use crate::error::AppResult;
use crate::indexer;
use crate::state::SharedState;
use crate::vector_store::{self, KnowledgeChunk};
use rig::embeddings::EmbeddingModel as _;
use rig::OneOrMany;
use std::time::Duration;

const INDEX_DEBOUNCE: Duration = Duration::from_millis(500);
const BATCH_PAUSE: Duration = Duration::from_millis(25);

pub fn status(state: &SharedState) -> AppResult<IndexStatus> {
    let conn = state.db.lock();
    db::get_index_status(&conn, state.indexing())
}

async fn rebuild(state: &SharedState) -> AppResult<IndexStatus> {
    let force = state.take_force_reindex();
    {
        let conn = state.db.lock();
        db::set_index_work_progress(&conn, "scanning", 0, 0, "Scanning Markdown changes…")?;
    }

    let known = {
        let conn = state.db.lock();
        db::list_indexed_files(&conn)?
    };
    if known.is_empty() && status(state)?.indexed_chunks > 0 {
        {
            let conn = state.db.lock();
            db::clear_chunks(&conn)?;
        }
        vector_store::clear_vector_db(&state.app_data_dir).await?;
    }

    let vault = state.vault_path();
    let plan =
        tokio::task::spawn_blocking(move || indexer::collect_index_plan(&vault, known, force))
            .await
            .map_err(|error| {
                crate::error::AppError::msg(format!("Index scan worker failed: {error}"))
            })??;
    let total_chunks = plan
        .changed
        .iter()
        .map(|file| file.chunks.len() as u32)
        .sum::<u32>();
    let mut processed_chunks = 0u32;

    if !plan.changed.is_empty() {
        let model = state.embedding_model().await?;
        for file in plan.changed {
            let mut embedded = Vec::with_capacity(file.chunks.len());
            for batch in file.chunks.chunks(INDEX_EMBED_BATCH_SIZE) {
                {
                    let conn = state.db.lock();
                    db::set_index_work_progress(
                        &conn,
                        "embedding",
                        processed_chunks,
                        total_chunks,
                        &format!(
                            "Embedding {} / {} changed chunks…",
                            processed_chunks, total_chunks
                        ),
                    )?;
                }
                let texts = batch
                    .iter()
                    .map(|chunk| chunk.content.clone())
                    .collect::<Vec<_>>();
                let vectors = model.embed_texts(texts).await.map_err(|error| {
                    crate::error::AppError::msg(format!("Embedding failed: {error}"))
                })?;
                embedded.extend(batch.iter().zip(vectors).map(|(chunk, embedding)| {
                    (
                        KnowledgeChunk {
                            id: chunk.id.clone(),
                            file_path: chunk.file_path.clone(),
                            title: chunk.title.clone(),
                            content: chunk.content.clone(),
                        },
                        OneOrMany::one(embedding),
                    )
                }));
                processed_chunks += batch.len() as u32;
                tokio::time::sleep(BATCH_PAUSE).await;
            }

            {
                let conn = state.db.lock();
                db::set_index_work_progress(
                    &conn,
                    "committing",
                    processed_chunks,
                    total_chunks,
                    &format!("Committing {}…", file.metadata.file_path),
                )?;
            }
            vector_store::replace_file_vectors(
                &state.app_data_dir,
                model.clone(),
                &file.metadata.file_path,
                embedded,
            )
            .await?;
            let conn = state.db.lock();
            db::replace_indexed_file(&conn, &file.metadata, &file.chunks)?;
        }
    }

    for path in plan.deleted {
        vector_store::remove_file_vectors(&state.app_data_dir, &path).await?;
        let conn = state.db.lock();
        db::remove_indexed_file(&conn, &path)?;
    }

    let conn = state.db.lock();
    let (file_count, chunk_count) = db::recount_index(&conn)?;
    db::set_index_complete(
        &conn,
        file_count,
        chunk_count,
        "Local FTS + FastEmbed vector index ready",
    )?;
    db::get_index_status(&conn, false)
}

pub fn schedule(state: &SharedState) -> AppResult<IndexStatus> {
    schedule_generation(state, false);
    status(state)
}

fn schedule_generation(state: &SharedState, force: bool) -> u64 {
    let generation = state.request_index_rebuild(force);
    if state.try_begin_indexing() {
        let state_clone = state.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(INDEX_DEBOUNCE).await;
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

pub async fn schedule_and_wait(
    state: &SharedState,
    timeout: Duration,
    force: bool,
) -> AppResult<IndexStatus> {
    let generation = schedule_generation(state, force);
    tokio::time::timeout(timeout, async {
        loop {
            if state.indexed_generation() >= generation {
                if state.successful_index_generation() >= generation {
                    return status(state);
                }
                return Err(crate::error::AppError::msg(
                    "workspace_reindex_failed: index synchronization did not complete successfully",
                ));
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .map_err(|_| crate::error::AppError::msg("workspace_reindex_timeout"))?
}
