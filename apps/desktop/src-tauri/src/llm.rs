//! OpenAI-compatible connection test and shared chat stream event types.

use crate::db::AppSettings;
use crate::db::Citation;
use crate::error::{AppError, AppResult};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatStreamEvent {
    /// Agent is consulting a vault file (RAG / tool result).
    Reading { path: String },
    /// Retrieval finished; waiting on / streaming the model reply.
    Generating,
    Citations { citations: Vec<Citation> },
    Token { content: String },
    Done { message_id: String },
    Error { message: String },
}

pub async fn test_connection(settings: &AppSettings) -> AppResult<String> {
    if settings.llm_api_key.trim().is_empty() {
        return Err(AppError::msg("API key not configured"));
    }
    let url = format!("{}/models", settings.llm_base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(&settings.llm_api_key)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::msg(format!(
            "Connection test failed ({status}): {body}"
        )));
    }
    Ok("Connection OK".into())
}
