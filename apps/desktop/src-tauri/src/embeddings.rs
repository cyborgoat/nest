//! Local FastEmbed model helpers for Nest retrieval.
//!
//! The model (weights + tokenizer) is bundled directly into the binary via
//! `include_bytes!` rather than downloaded from Hugging Face on first run.
//! The download path was unreliable on Windows (network/proxy/AV
//! interference on an unsigned build) and failed silently, so the app fell
//! back to lexical-only retrieval with no visible error.

use crate::error::{AppError, AppResult};
use fastembed::{
    EmbeddingModel as FastembedModel, InitOptionsUserDefined, QuantizationMode, TextEmbedding,
    TokenizerFiles, UserDefinedEmbeddingModel,
};
use parking_lot::Mutex;
use rig::embeddings::{Embedding, EmbeddingError, EmbeddingModel as RigEmbeddingModel};
use std::sync::Arc;

const ONNX_MODEL: &[u8] = include_bytes!("../assets/embedding-model/model_quantized.onnx");
const TOKENIZER_JSON: &[u8] = include_bytes!("../assets/embedding-model/tokenizer.json");
const CONFIG_JSON: &[u8] = include_bytes!("../assets/embedding-model/config.json");
const SPECIAL_TOKENS_MAP_JSON: &[u8] =
    include_bytes!("../assets/embedding-model/special_tokens_map.json");
const TOKENIZER_CONFIG_JSON: &[u8] =
    include_bytes!("../assets/embedding-model/tokenizer_config.json");

const EMBEDDING_DIMS: usize = 384;
pub const INDEX_EMBED_BATCH_SIZE: usize = 16;
const EMBEDDING_THREADS: usize = 2;

/// Rig-compatible handle around one shared FastEmbed session. FastEmbed 5.15's
/// supported intra-op setting keeps ONNX from occupying every logical core;
/// the mutex also prevents retrieval and indexing from running inference at
/// the same time.
#[derive(Clone)]
pub struct EmbeddingModel {
    inner: Arc<Mutex<TextEmbedding>>,
}

impl RigEmbeddingModel for EmbeddingModel {
    const MAX_DOCUMENTS: usize = INDEX_EMBED_BATCH_SIZE;
    type Client = Self;

    fn make(client: &Self::Client, _model: impl Into<String>, _dims: Option<usize>) -> Self {
        client.clone()
    }

    fn ndims(&self) -> usize {
        EMBEDDING_DIMS
    }

    fn embed_texts(
        &self,
        documents: impl IntoIterator<Item = String> + Send,
    ) -> impl std::future::Future<Output = Result<Vec<Embedding>, EmbeddingError>> + Send {
        let documents = documents.into_iter().collect::<Vec<_>>();
        let inner = self.inner.clone();
        async move {
            tokio::task::spawn_blocking(move || {
                let vectors = inner
                    .lock()
                    .embed(&documents, None)
                    .map_err(|error| EmbeddingError::ProviderError(error.to_string()))?;
                Ok(documents
                    .into_iter()
                    .zip(vectors)
                    .map(|(document, vector)| Embedding {
                        document,
                        vec: vector.into_iter().map(f64::from).collect(),
                    })
                    .collect())
            })
            .await
            .map_err(|error| EmbeddingError::ProviderError(error.to_string()))?
        }
    }
}

/// Load the bundled FastEmbed model (`Xenova/all-MiniLM-L6-v2`, quantized).
pub fn load_embedding_model() -> AppResult<EmbeddingModel> {
    TextEmbedding::get_model_info(&FastembedModel::AllMiniLML6V2Q)
        .map_err(|e| AppError::msg(format!("Bundled embedding model metadata error: {e}")))?;

    let tokenizer_files = TokenizerFiles {
        tokenizer_file: TOKENIZER_JSON.to_vec(),
        config_file: CONFIG_JSON.to_vec(),
        special_tokens_map_file: SPECIAL_TOKENS_MAP_JSON.to_vec(),
        tokenizer_config_file: TOKENIZER_CONFIG_JSON.to_vec(),
    };
    let user_defined = UserDefinedEmbeddingModel::new(ONNX_MODEL.to_vec(), tokenizer_files)
        .with_quantization(QuantizationMode::Dynamic);

    let options = InitOptionsUserDefined::new().with_intra_threads(EMBEDDING_THREADS);
    let model = TextEmbedding::try_new_from_user_defined(user_defined, options)
        .map_err(|e| AppError::msg(format!("Failed to load bundled embedding model: {e}")))?;
    Ok(EmbeddingModel {
        inner: Arc::new(Mutex::new(model)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Guards against the bundled model assets going stale or missing: this
    /// must succeed using only `include_bytes!` data, with no network access
    /// and no HF_HOME cache dir — the exact failure mode that broke
    /// retrieval on Windows when the model was downloaded at runtime.
    #[tokio::test]
    async fn bundled_model_loads_and_embeds() {
        let model = load_embedding_model().expect("bundled model should load");
        let embedding = model
            .embed_text("hello from a bundled embedding model")
            .await
            .expect("embedding should succeed");
        assert_eq!(embedding.vec.len(), EMBEDDING_DIMS);
    }
}
