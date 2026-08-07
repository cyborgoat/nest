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
    retrieval_prefixes: &[String],
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

    // Empty prefixes → no hits (chat resolves active packs / focus before calling).
    if retrieval_prefixes.is_empty() {
        return Ok(Vec::new());
    }

    let mut builder = VectorSearchRequest::builder()
        .query(query)
        .samples(u64::from(top_k.max(1)));

    {
        let mut filter: Option<SqliteSearchFilter> = None;
        for scope in retrieval_prefixes {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embeddings::load_embedding_model;

    #[test]
    fn vectors_db_path_is_a_sibling_file_under_app_data() {
        let dir = Path::new("/tmp/some-app-data");
        assert_eq!(vectors_db_path(dir), dir.join("nest-vectors.db"));
    }

    #[tokio::test]
    async fn clear_vector_db_removes_existing_files_and_is_a_noop_when_absent() {
        let root =
            std::env::temp_dir().join(format!("nest-vector-clear-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let db_path = vectors_db_path(&root);
        tokio::fs::write(&db_path, b"stub").await.unwrap();
        tokio::fs::write(format!("{}-wal", db_path.display()), b"stub")
            .await
            .unwrap();
        tokio::fs::write(format!("{}-shm", db_path.display()), b"stub")
            .await
            .unwrap();

        clear_vector_db(&root).await.unwrap();

        assert!(!db_path.exists());
        assert!(!Path::new(&format!("{}-wal", db_path.display())).exists());
        assert!(!Path::new(&format!("{}-shm", db_path.display())).exists());

        // Nothing left to remove — must not error on a second call.
        clear_vector_db(&root).await.unwrap();

        let _ = tokio::fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn vector_search_returns_empty_when_no_index_exists_yet() {
        let root =
            std::env::temp_dir().join(format!("nest-vector-missing-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let model = load_embedding_model().expect("bundled model should load");

        let results = vector_search(&root, model, "anything", 5, &["docs".to_string()])
            .await
            .unwrap();
        assert!(results.is_empty());

        let _ = tokio::fs::remove_dir_all(root).await;
    }

    /// Exercises the real embed -> insert -> search path end to end: builds
    /// an index from two semantically distinct chunks, then confirms a
    /// query finds the relevant one and that prefix filtering (and an empty
    /// filter list) behave as `chat_send`'s retrieval path relies on.
    #[tokio::test]
    async fn rebuild_then_search_finds_the_relevant_chunk_and_respects_prefix_filters() {
        let root = std::env::temp_dir().join(format!(
            "nest-vector-roundtrip-test-{}",
            uuid::Uuid::new_v4()
        ));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let model = load_embedding_model().expect("bundled model should load");

        let chunks = vec![
            KnowledgeChunk {
                id: "1".to_string(),
                file_path: "docs/cats.md".to_string(),
                title: "Cats".to_string(),
                content: "Cats are small domesticated carnivorous mammals valued as pets."
                    .to_string(),
            },
            KnowledgeChunk {
                id: "2".to_string(),
                file_path: "docs/rockets.md".to_string(),
                title: "Rockets".to_string(),
                content: "A rocket engine produces thrust by expelling propellant at high speed."
                    .to_string(),
            },
        ];
        rebuild_vector_index(&root, model.clone(), chunks)
            .await
            .expect("rebuild should succeed");

        // Empty retrieval_prefixes short-circuits to no hits even once a
        // real index exists — chat resolves active packs/focus before
        // calling, and an empty scope means nothing is in scope.
        let scoped_out = vector_search(&root, model.clone(), "domesticated pet animal", 5, &[])
            .await
            .unwrap();
        assert!(scoped_out.is_empty());

        let results = vector_search(
            &root,
            model,
            "domesticated pet animal",
            5,
            &["docs/cats.md".to_string()],
        )
        .await
        .expect("search should succeed");

        assert!(!results.is_empty());
        assert_eq!(results[0].1.file_path, "docs/cats.md");

        let _ = tokio::fs::remove_dir_all(root).await;
    }
}
