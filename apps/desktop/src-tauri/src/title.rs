//! Auto-generate a short chat session title from early turns.

use crate::db::{self, AppSettings, ChatSession};
use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ChoiceMessage,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    content: Option<String>,
}

pub fn load_session_turns(
    conn: &Connection,
    session_id: &str,
) -> AppResult<(ChatSession, Vec<(String, String)>)> {
    let session = db::get_session(conn, session_id)?
        .ok_or_else(|| AppError::msg(format!("Session not found: {session_id}")))?;
    let messages = db::list_messages(conn, session_id)?;
    let turns: Vec<(String, String)> = messages
        .into_iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .take(2)
        .map(|m| (m.role, m.content))
        .collect();
    Ok((session, turns))
}

/// Name a placeholder session after its first completed exchange.
pub async fn maybe_auto_title_after_reply(
    settings: &AppSettings,
    session_id: &str,
    load: impl FnOnce() -> AppResult<(ChatSession, Vec<(String, String)>)>,
    save: impl FnOnce(&str) -> AppResult<ChatSession>,
) -> Option<ChatSession> {
    let (session, turns) = load().ok()?;
    if session.title_source != db::TITLE_SOURCE_PLACEHOLDER {
        return None;
    }
    // Need at least one user + one assistant turn.
    if turns.len() < 2 {
        return None;
    }
    match generate_title(settings, &turns).await {
        Ok(title) => save(&title).ok(),
        Err(e) => {
            crate::nest_debug!("title", "auto title failed for {session_id}: {e}");
            let title = fallback_title(&turns);
            save(&title).ok()
        }
    }
}

async fn generate_title(settings: &AppSettings, turns: &[(String, String)]) -> AppResult<String> {
    if settings.llm_api_key.trim().is_empty() {
        return Err(AppError::msg("API key not configured"));
    }
    if settings.llm_base_url.trim().is_empty() {
        return Err(AppError::msg("LLM Base URL not configured"));
    }
    if settings.chat_model.trim().is_empty() {
        return Err(AppError::msg("Chat model not configured"));
    }

    let mut transcript = String::new();
    for (role, content) in turns.iter().take(2) {
        let clipped: String = content.chars().take(400).collect();
        transcript.push_str(&format!("{role}: {clipped}\n"));
    }

    let url = format!(
        "{}/chat/completions",
        settings.llm_base_url.trim_end_matches('/')
    );
    let body = json!({
        "model": settings.chat_model,
        "temperature": 0.3,
        "max_tokens": 24,
        "messages": [
            {
                "role": "system",
                "content": "You name chat conversations. Reply with a short title only (max 6 words). No quotes, no punctuation at the end, no explanation."
            },
            {
                "role": "user",
                "content": format!("Write a short title for this conversation:\n{transcript}")
            }
        ]
    });

    let client = crate::http::build_client(settings.effective_proxy_url())?;
    let resp = client
        .post(&url)
        .bearer_auth(&settings.llm_api_key)
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::msg(format!(
            "Title generation failed ({status}): {text}"
        )));
    }

    let parsed: ChatCompletionResponse = resp.json().await?;
    let raw = parsed
        .choices
        .first()
        .and_then(|c| c.message.content.as_ref())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::msg("Empty title from model"))?;

    Ok(sanitize_title(raw))
}

fn sanitize_title(raw: &str) -> String {
    let cleaned = raw
        .trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '`' || c == '.' || c == '!')
        .trim();
    let words: Vec<&str> = cleaned.split_whitespace().take(6).collect();
    let title = words
        .join(" ")
        .trim_end_matches(|c: char| c.is_ascii_punctuation())
        .to_string();
    if title.is_empty() {
        "New chat".into()
    } else {
        title
    }
}

fn fallback_title(turns: &[(String, String)]) -> String {
    turns
        .iter()
        .find(|(role, _)| role == "user")
        .map(|(_, content)| sanitize_title(content))
        .unwrap_or_else(|| "New chat".into())
}

#[cfg(test)]
mod tests {
    use super::{fallback_title, sanitize_title};

    #[test]
    fn sanitizes_generated_titles() {
        assert_eq!(
            sanitize_title("\"Importing Knowledge Packs!\""),
            "Importing Knowledge Packs"
        );
        assert_eq!(
            sanitize_title("A title with more than six useful words here"),
            "A title with more than six"
        );
    }

    #[test]
    fn falls_back_to_the_first_user_topic() {
        let turns = vec![
            ("user".into(), "How do I import a knowledge pack?".into()),
            ("assistant".into(), "Use the import menu.".into()),
        ];
        assert_eq!(fallback_title(&turns), "How do I import a knowledge");
    }
}
