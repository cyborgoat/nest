//! Conversation history helpers and Sqlite-backed Rig ConversationMemory.

use crate::db;
use crate::error::AppResult;
use crate::state::SharedState;
use parking_lot::Mutex;
use rig::completion::Message;
use rig::memory::{ConversationMemory, MemoryError};
use rig::wasm_compat::WasmBoxedFuture;
use rusqlite::Connection;
use std::sync::Arc;

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
pub struct SqliteConversationMemory {
    state: SharedState,
    /// When true, `append` is a no-op (Nest persists user/assistant itself).
    skip_persist: Arc<Mutex<bool>>,
}

impl SqliteConversationMemory {
    pub fn new(state: SharedState) -> Self {
        Self {
            state,
            skip_persist: Arc::new(Mutex::new(true)),
        }
    }

    pub fn set_skip_persist(&self, skip: bool) {
        *self.skip_persist.lock() = skip;
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
        conversation_id: &'a str,
        messages: Vec<Message>,
    ) -> WasmBoxedFuture<'a, Result<(), MemoryError>> {
        let state = self.state.clone();
        let skip = *self.skip_persist.lock();
        let id = conversation_id.to_string();
        Box::pin(async move {
            if skip {
                return Ok(());
            }
            let conn = state.db.lock();
            for msg in messages {
                match msg {
                    Message::User { content } => {
                        let text: String = content
                            .into_iter()
                            .filter_map(|c| match c {
                                rig::message::UserContent::Text(t) => Some(t.text),
                                _ => None,
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        if !text.is_empty() {
                            db::add_message(&conn, &id, "user", &text, None)
                                .map_err(|e| MemoryError::backend(e.to_string()))?;
                        }
                    }
                    Message::Assistant { content, .. } => {
                        let text: String = content
                            .into_iter()
                            .filter_map(|c| match c {
                                rig::message::AssistantContent::Text(t) => Some(t.text),
                                _ => None,
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        if !text.is_empty() {
                            db::add_message(&conn, &id, "assistant", &text, None)
                                .map_err(|e| MemoryError::backend(e.to_string()))?;
                        }
                    }
                    _ => {}
                }
            }
            Ok(())
        })
    }

    fn clear<'a>(
        &'a self,
        _conversation_id: &'a str,
    ) -> WasmBoxedFuture<'a, Result<(), MemoryError>> {
        Box::pin(async move { Ok(()) })
    }
}
