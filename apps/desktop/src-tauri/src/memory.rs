//! Conversation history helpers and Sqlite-backed Rig ConversationMemory.

use crate::db;
use crate::error::AppResult;
use crate::state::SharedState;
use rig::completion::Message;
use rig::memory::{ConversationMemory, MemoryError};
use rig::wasm_compat::WasmBoxedFuture;
use rusqlite::Connection;

const HISTORY_WINDOW: usize = 24;

pub fn messages_to_rig_history(messages: &[crate::db::ChatMessage]) -> Vec<Message> {
    messages
        .iter()
        .filter_map(|m| match m.role.as_str() {
            "user" => Some(Message::user(&m.content)),
            "assistant" => Some(Message::assistant(&m.content)),
            "system" => Some(Message::system(&m.content)),
            _ => None,
        })
        .collect()
}

/// Load a sliding window of prior turns for a chat session.
pub fn load_history(conn: &Connection, session_id: &str) -> AppResult<Vec<Message>> {
    let mut messages = db::list_messages(conn, session_id)?;
    if messages.len() > HISTORY_WINDOW {
        messages = messages.split_off(messages.len() - HISTORY_WINDOW);
    }
    Ok(messages_to_rig_history(&messages))
}

/// Rig ConversationMemory wired to Nest's `chat_messages` table.
///
/// Nest persists user/assistant messages itself, so `append` is always a no-op.
pub struct SqliteConversationMemory {
    state: SharedState,
}

impl SqliteConversationMemory {
    pub fn new(state: SharedState) -> Self {
        Self { state }
    }
}

impl ConversationMemory for SqliteConversationMemory {
    fn load<'a>(
        &'a self,
        conversation_id: &'a str,
    ) -> WasmBoxedFuture<'a, Result<Vec<Message>, MemoryError>> {
        let state = self.state.clone();
        let id = conversation_id.to_string();
        Box::pin(async move {
            let conn = state.db.lock();
            load_history(&conn, &id).map_err(|e| MemoryError::backend(e.to_string()))
        })
    }

    fn append<'a>(
        &'a self,
        _conversation_id: &'a str,
        _messages: Vec<Message>,
    ) -> WasmBoxedFuture<'a, Result<(), MemoryError>> {
        Box::pin(async move { Ok(()) })
    }

    fn clear<'a>(
        &'a self,
        _conversation_id: &'a str,
    ) -> WasmBoxedFuture<'a, Result<(), MemoryError>> {
        Box::pin(async move { Ok(()) })
    }
}
