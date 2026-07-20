//! Local FastEmbed model helpers for Nest retrieval.

use crate::error::{AppError, AppResult};
use rig_fastembed::{Client as FastembedClient, EmbeddingModel, FastembedModel};
use std::path::Path;

pub const DEFAULT_EMBEDDING_MODEL: &str = "AllMiniLML6V2Q";

/// Keep FastEmbed's model files in the app data directory. In a bundled app the
/// process may not have the same working directory or home-directory setup as
/// `tauri dev`; relying on FastEmbed's implicit cache made retrieval unreliable.
pub fn configure_cache(app_data_dir: &Path) -> AppResult<()> {
    if std::env::var_os("HF_HOME").is_none() {
        let cache_dir = app_data_dir.join("fastembed-cache");
        std::fs::create_dir_all(&cache_dir)?;
        std::env::set_var("HF_HOME", cache_dir);
    }
    Ok(())
}

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
