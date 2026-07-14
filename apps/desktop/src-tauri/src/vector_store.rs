//! SQLite-vec vector store for Nest knowledge chunks (sibling nest-vectors.db).

use crate::error::{AppError, AppResult};
use rig::embeddings::EmbeddingsBuilder;
use rig::vector_store::request::{SearchFilter, VectorSearchRequest};
use rig::vector_store::{InsertDocuments, VectorStoreIndex};
use rig::Embed;
use rig_fastembed::EmbeddingModel;
use rig_sqlite::{
    Column, ColumnValue, SqliteDistanceMetric, SqliteSearchFilter, SqliteVectorStore,
    SqliteVectorStoreTable,
};
use rusqlite::ffi::{sqlite3, sqlite3_api_routines, sqlite3_auto_extension};
use serde::{Deserialize, Serialize};
use sqlite_vec::sqlite3_vec_init;
use std::os::raw::c_char;
use std::path::{Path, PathBuf};
use std::sync::Once;
use tokio_rusqlite::Connection;

static VEC_EXT: Once = Once::new();

type SqliteExtensionFn =
    unsafe extern "C" fn(*mut sqlite3, *mut *mut c_char, *const sqlite3_api_routines) -> i32;

fn ensure_sqlite_vec() {
    VEC_EXT.call_once(|| unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute::<*const (), SqliteExtensionFn>(
            sqlite3_vec_init as *const (),
        )));
    });
}

#[derive(Embed, Clone, Debug, Deserialize, Serialize)]
pub struct KnowledgeChunk {
    pub id: String,
    pub file_path: String,
    pub title: String,
    #[embed]
    pub content: String,
}

impl SqliteVectorStoreTable for KnowledgeChunk {
    fn name() -> &'static str {
        "knowledge_chunks"
    }

    fn schema() -> Vec<Column> {
        vec![
            Column::new("id", "TEXT PRIMARY KEY"),
            Column::new("file_path", "TEXT").indexed(),
            Column::new("title", "TEXT"),
            Column::new("content", "TEXT"),
        ]
    }

    fn id(&self) -> String {
        self.id.clone()
    }

    fn column_values(&self) -> Vec<(&'static str, Box<dyn ColumnValue>)> {
        vec![
            ("id", Box::new(self.id.clone())),
            ("file_path", Box::new(self.file_path.clone())),
            ("title", Box::new(self.title.clone())),
            ("content", Box::new(self.content.clone())),
        ]
    }
}

pub fn vectors_db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("nest-vectors.db")
}

pub async fn clear_vector_db(app_data_dir: &Path) -> AppResult<()> {
    let path = vectors_db_path(app_data_dir);
    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| AppError::msg(format!("Failed to clear vector DB: {e}")))?;
    }
    for suffix in ["-wal", "-shm"] {
        let p = PathBuf::from(format!("{}{suffix}", path.display()));
        if p.exists() {
            let _ = tokio::fs::remove_file(&p).await;
        }
    }
    Ok(())
}

async fn open_vec_conn(app_data_dir: &Path) -> AppResult<Connection> {
    ensure_sqlite_vec();
    let path = vectors_db_path(app_data_dir);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::msg(e.to_string()))?;
    }
    Connection::open(path)
        .await
        .map_err(|e| AppError::msg(format!("Failed to open vector DB: {e}")))
}

pub async fn rebuild_vector_index(
    app_data_dir: &Path,
    embedding_model: EmbeddingModel,
    chunks: Vec<KnowledgeChunk>,
) -> AppResult<()> {
    clear_vector_db(app_data_dir).await?;
    if chunks.is_empty() {
        return Ok(());
    }

    let conn = open_vec_conn(app_data_dir).await?;
    let store: SqliteVectorStore<_, KnowledgeChunk> = SqliteVectorStore::with_distance_metric(
        conn,
        &embedding_model,
        SqliteDistanceMetric::Cosine,
    )
    .await
    .map_err(|e| AppError::msg(format!("Vector store init failed: {e}")))?;

    let embeddings = EmbeddingsBuilder::new(embedding_model)
        .documents(chunks)
        .map_err(|e| AppError::msg(format!("Failed to prepare embeddings: {e}")))?
        .build()
        .await
        .map_err(|e| AppError::msg(format!("Embedding failed: {e}")))?;

    store
        .insert_documents(embeddings)
        .await
        .map_err(|e| AppError::msg(format!("Failed to insert vectors: {e}")))?;

    Ok(())
}

pub async fn vector_search(
    app_data_dir: &Path,
    embedding_model: EmbeddingModel,
    query: &str,
    top_k: u32,
    scope_paths: &[String],
) -> AppResult<Vec<(f64, KnowledgeChunk)>> {
    let path = vectors_db_path(app_data_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let conn = open_vec_conn(app_data_dir).await?;
    let store: SqliteVectorStore<_, KnowledgeChunk> = SqliteVectorStore::with_distance_metric(
        conn,
        &embedding_model,
        SqliteDistanceMetric::Cosine,
    )
    .await
    .map_err(|e| AppError::msg(format!("Vector store open failed: {e}")))?;

    let index = store.index(embedding_model);

    let mut builder = VectorSearchRequest::builder()
        .query(query)
        .samples(u64::from(top_k.max(1)));

    if !scope_paths.is_empty() {
        let mut filter: Option<SqliteSearchFilter> = None;
        for scope in scope_paths {
            let like = SqliteSearchFilter::like("file_path".to_string(), format!("{scope}%"));
            let eq = SqliteSearchFilter::eq("file_path", serde_json::json!(scope));
            let part = like.or(eq);
            filter = Some(match filter {
                Some(f) => f.or(part),
                None => part,
            });
        }
        if let Some(f) = filter {
            builder = builder.filter(f);
        }
    }

    let req = builder.build();

    let results = index
        .top_n::<KnowledgeChunk>(req)
        .await
        .map_err(|e| AppError::msg(format!("Vector search failed: {e}")))?;

    Ok(results
        .into_iter()
        .map(|(score, _id, doc)| (score, doc))
        .collect())
}
