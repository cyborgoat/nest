//! Local FastEmbed model helpers for Nest retrieval.
//!
//! The model (weights + tokenizer) is bundled directly into the binary via
//! `include_bytes!` rather than downloaded from Hugging Face on first run.
//! The download path was unreliable on Windows (network/proxy/AV
//! interference on an unsigned build) and failed silently, so the app fell
//! back to lexical-only retrieval with no visible error.

use crate::error::{AppError, AppResult};
use fastembed::{QuantizationMode, TextEmbedding, TokenizerFiles, UserDefinedEmbeddingModel};
use rig_fastembed::{EmbeddingModel, FastembedModel};

const ONNX_MODEL: &[u8] = include_bytes!("../assets/embedding-model/model_quantized.onnx");
const TOKENIZER_JSON: &[u8] = include_bytes!("../assets/embedding-model/tokenizer.json");
const CONFIG_JSON: &[u8] = include_bytes!("../assets/embedding-model/config.json");
const SPECIAL_TOKENS_MAP_JSON: &[u8] =
    include_bytes!("../assets/embedding-model/special_tokens_map.json");
const TOKENIZER_CONFIG_JSON: &[u8] =
    include_bytes!("../assets/embedding-model/tokenizer_config.json");

const EMBEDDING_DIMS: usize = 384;

/// Load the bundled FastEmbed model (`Xenova/all-MiniLM-L6-v2`, quantized).
pub fn load_embedding_model() -> AppResult<EmbeddingModel> {
    let model_info = TextEmbedding::get_model_info(&FastembedModel::AllMiniLML6V2Q)
        .map_err(|e| AppError::msg(format!("Bundled embedding model metadata error: {e}")))?;

    let tokenizer_files = TokenizerFiles {
        tokenizer_file: TOKENIZER_JSON.to_vec(),
        config_file: CONFIG_JSON.to_vec(),
        special_tokens_map_file: SPECIAL_TOKENS_MAP_JSON.to_vec(),
        tokenizer_config_file: TOKENIZER_CONFIG_JSON.to_vec(),
    };
    let user_defined = UserDefinedEmbeddingModel::new(ONNX_MODEL.to_vec(), tokenizer_files)
        .with_quantization(QuantizationMode::Dynamic);

    EmbeddingModel::new_from_user_defined(user_defined, EMBEDDING_DIMS, model_info)
        .map_err(|e| AppError::msg(format!("Failed to load bundled embedding model: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig::embeddings::EmbeddingModel as _;

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
