use crate::db::{AppSettings, Citation};
use crate::error::{AppError, AppResult};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatStreamEvent {
    Citations { citations: Vec<Citation> },
    Token { content: String },
    Done { message_id: String },
    Error { message: String },
}

pub async fn stream_chat(
    app: &AppHandle,
    event_name: &str,
    settings: &AppSettings,
    system: &str,
    user: &str,
    citations: Vec<Citation>,
) -> AppResult<String> {
    if settings.llm_api_key.trim().is_empty() {
        return Err(AppError::msg("API key not configured"));
    }

    let _ = app.emit(
        event_name,
        ChatStreamEvent::Citations {
            citations: citations.clone(),
        },
    );

    let url = format!(
        "{}/chat/completions",
        settings.llm_base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&settings.llm_api_key)
        .json(&json!({
            "model": settings.chat_model,
            "stream": true,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let msg = format!("Chat request failed ({status}): {body}");
        let _ = app.emit(event_name, ChatStreamEvent::Error { message: msg.clone() });
        return Err(AppError::msg(msg));
    }

    let mut stream = resp.bytes_stream();
    let mut full = String::new();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[pos + 1..].to_string();
            if !line.starts_with("data:") {
                continue;
            }
            let data = line.trim_start_matches("data:").trim();
            if data == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(content) = v["choices"][0]["delta"]["content"].as_str() {
                    full.push_str(content);
                    let _ = app.emit(
                        event_name,
                        ChatStreamEvent::Token {
                            content: content.to_string(),
                        },
                    );
                }
            }
        }
    }

    if full.trim().is_empty() {
        let msg = "LLM returned an empty response".to_string();
        let _ = app.emit(event_name, ChatStreamEvent::Error { message: msg.clone() });
        return Err(AppError::msg(msg));
    }

    Ok(full)
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
