//! Local FastEmbed model helpers for Nest retrieval.

use crate::error::{AppError, AppResult};
use rig_fastembed::{Client as FastembedClient, EmbeddingModel, FastembedModel};

pub const DEFAULT_EMBEDDING_MODEL: &str = "AllMiniLML6V2Q";

pub fn parse_model_id(id: &str) -> FastembedModel {
    match id.trim() {
        "AllMiniLML6V2" => FastembedModel::AllMiniLML6V2,
        "AllMiniLML6V2Q" => FastembedModel::AllMiniLML6V2Q,
        "AllMiniLML12V2" => FastembedModel::AllMiniLML12V2,
        "AllMiniLML12V2Q" => FastembedModel::AllMiniLML12V2Q,
        "BGESmallENV15" => FastembedModel::BGESmallENV15,
        "BGESmallENV15Q" => FastembedModel::BGESmallENV15Q,
        "BGEBaseENV15" => FastembedModel::BGEBaseENV15,
        "BGEBaseENV15Q" => FastembedModel::BGEBaseENV15Q,
        _ => FastembedModel::AllMiniLML6V2Q,
    }
}

/// Load a local FastEmbed model (downloads ONNX weights on first use).
pub fn load_embedding_model(model_id: &str) -> AppResult<EmbeddingModel> {
    let model = parse_model_id(model_id);
    FastembedClient::new()
        .embedding_model(&model)
        .map_err(|e| AppError::msg(format!("Failed to load embedding model: {e}")))
}
