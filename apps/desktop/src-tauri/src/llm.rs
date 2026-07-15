//! Shared chat stream event types for Nest agent replies.

use crate::db::Citation;
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
