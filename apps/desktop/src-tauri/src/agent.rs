//! Rig agent: OpenAI-compatible chat + local vault_search tool + streaming.

use crate::db::{AppSettings, Citation};
use crate::error::{AppError, AppResult};
use crate::llm::ChatStreamEvent;
use crate::memory::SqliteConversationMemory;
use crate::retrieval::{self, agent_preamble, format_citations_for_tool, DEFAULT_TOP_K};
use crate::state::SharedState;
use futures::StreamExt;
use parking_lot::Mutex;
use rig::agent::MultiTurnStreamItem;
use rig::client::CompletionClient;
use rig::completion::message::Text;
use rig::completion::Message;
use rig::providers::openai;
use rig::streaming::{StreamedAssistantContent, StreamingChat};
use rig::tool::Tool;
use serde::Deserialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use thiserror::Error;

#[derive(Debug, Error)]
#[error("{0}")]
pub struct VaultSearchError(String);

#[derive(Deserialize)]
pub struct VaultSearchArgs {
    pub query: String,
    pub top_k: Option<u32>,
}

#[derive(Clone)]
pub struct VaultSearchTool {
    state: SharedState,
    app: AppHandle,
    stream_event: String,
    app_data_dir: PathBuf,
    embedding_model_id: String,
    default_top_k: u32,
    scope_paths: Arc<Vec<String>>,
    citations: Arc<Mutex<Vec<Citation>>>,
}

impl Tool for VaultSearchTool {
    const NAME: &'static str = "vault_search";

    type Error = VaultSearchError;
    type Args = VaultSearchArgs;
    type Output = String;

    fn description(&self) -> String {
        "Search the local Nest knowledge vault (Markdown packs) for passages relevant to a query. \
         Always call this before answering factual questions about library content."
            .into()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural-language search query"
                },
                "top_k": {
                    "type": "integer",
                    "description": "Max passages to return (default from settings)"
                }
            },
            "required": ["query"]
        })
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let top_k = args.top_k.unwrap_or(self.default_top_k).max(1);
        let citations = retrieval::retrieve(
            &self.app_data_dir,
            &self.state,
            &self.embedding_model_id,
            &args.query,
            &self.scope_paths,
            top_k,
        )
        .await
        .map_err(|e| VaultSearchError(e.to_string()))?;

        emit_reading_files(&self.app, &self.stream_event, &citations).await;
        *self.citations.lock() = citations.clone();
        let _ = self.app.emit(
            &self.stream_event,
            ChatStreamEvent::Citations {
                citations: citations.clone(),
            },
        );
        Ok(format_citations_for_tool(&citations))
    }
}

/// Result of an agent chat run. `cancelled` is true when the user stopped generation.
pub struct AgentChatResult {
    pub answer: String,
    pub citations: Vec<Citation>,
    pub cancelled: bool,
}

async fn emit_reading_files(app: &AppHandle, stream_event: &str, citations: &[Citation]) {
    let mut seen = HashSet::new();
    for c in citations {
        if !seen.insert(c.file_path.clone()) {
            continue;
        }
        let _ = app.emit(
            stream_event,
            ChatStreamEvent::Reading {
                path: c.file_path.clone(),
            },
        );
        // Brief pause so the UI can show each file before the next.
        tokio::time::sleep(Duration::from_millis(90)).await;
    }
}

pub async fn run_agent_chat(
    app: &AppHandle,
    state: SharedState,
    app_data_dir: PathBuf,
    settings: &AppSettings,
    session_id: &str,
    query: &str,
    scope_paths: Vec<String>,
    stream_event: &str,
    prior_history: Vec<Message>,
) -> AppResult<AgentChatResult> {
    if settings.llm_api_key.trim().is_empty() {
        return Err(AppError::msg("API key not configured"));
    }

    state.clear_chat_cancel();

    let citations_slot: Arc<Mutex<Vec<Citation>>> = Arc::new(Mutex::new(Vec::new()));

    let tool = VaultSearchTool {
        state: state.clone(),
        app: app.clone(),
        stream_event: stream_event.to_string(),
        app_data_dir: app_data_dir.clone(),
        embedding_model_id: settings.embedding_model.clone(),
        default_top_k: DEFAULT_TOP_K,
        scope_paths: Arc::new(scope_paths.clone()),
        citations: citations_slot.clone(),
    };

    let memory = SqliteConversationMemory::new(state.clone());
    memory.set_skip_persist(true);

    let openai = openai::Client::builder()
        .api_key(settings.llm_api_key.clone())
        .base_url(settings.llm_base_url.trim_end_matches('/'))
        .build()
        .map_err(|e| AppError::msg(format!("Failed to build OpenAI client: {e}")))?
        .completions_api();

    let agent = openai
        .agent(&settings.chat_model)
        .preamble(agent_preamble())
        .tool(tool)
        .memory(memory)
        .build();

    let eager = retrieval::retrieve(
        &app_data_dir,
        &state,
        &settings.embedding_model,
        query,
        &scope_paths,
        DEFAULT_TOP_K,
    )
    .await
    .unwrap_or_default();
    if !eager.is_empty() {
        emit_reading_files(app, stream_event, &eager).await;
        *citations_slot.lock() = eager;
        let _ = app.emit(
            stream_event,
            ChatStreamEvent::Citations {
                citations: citations_slot.lock().clone(),
            },
        );
    }

    let _ = app.emit(stream_event, ChatStreamEvent::Generating);

    let mut stream = agent
        .stream_chat(query, prior_history)
        .max_turns(3)
        .conversation(session_id)
        .await;

    let mut full = String::new();
    let mut cancelled = false;
    let mut emitted_generating = true;

    while let Some(item) = stream.next().await {
        if state.chat_cancel_requested() {
            cancelled = true;
            break;
        }
        match item {
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(
                Text { text, .. },
            ))) => {
                if !emitted_generating {
                    let _ = app.emit(stream_event, ChatStreamEvent::Generating);
                    emitted_generating = true;
                }
                full.push_str(&text);
                let _ = app.emit(
                    stream_event,
                    ChatStreamEvent::Token {
                        content: text.clone(),
                    },
                );
            }
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::ToolCall {
                tool_call,
                ..
            })) => {
                emitted_generating = false;
                let name = tool_call.function.name.clone();
                let _ = app.emit(
                    stream_event,
                    ChatStreamEvent::Reading {
                        path: if name.is_empty() {
                            "vault_search".into()
                        } else {
                            name
                        },
                    },
                );
            }
            Ok(MultiTurnStreamItem::FinalResponse(resp)) => {
                if full.trim().is_empty() && !resp.output.trim().is_empty() {
                    full = resp.output;
                }
            }
            Ok(_) => {}
            Err(e) => {
                if state.chat_cancel_requested() {
                    cancelled = true;
                    break;
                }
                let msg = e.to_string();
                let _ = app.emit(
                    stream_event,
                    ChatStreamEvent::Error {
                        message: msg.clone(),
                    },
                );
                return Err(AppError::msg(msg));
            }
        }
    }

    if state.chat_cancel_requested() {
        cancelled = true;
    }
    state.clear_chat_cancel();

    let citations = citations_slot.lock().clone();
    if !citations.is_empty() {
        let _ = app.emit(
            stream_event,
            ChatStreamEvent::Citations {
                citations: citations.clone(),
            },
        );
    }

    if cancelled {
        if full.trim().is_empty() {
            return Err(AppError::msg("cancelled"));
        }
        return Ok(AgentChatResult {
            answer: full,
            citations,
            cancelled: true,
        });
    }

    if full.trim().is_empty() {
        let msg = "LLM returned an empty response".to_string();
        let _ = app.emit(stream_event, ChatStreamEvent::Error { message: msg.clone() });
        return Err(AppError::msg(msg));
    }

    Ok(AgentChatResult {
        answer: full,
        citations,
        cancelled: false,
    })
}
