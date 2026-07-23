//! Conversion helpers for the bounded chat history passed to Rig.

use rig::completion::Message;

const HISTORY_WINDOW: usize = 24;

pub fn messages_to_rig_history(messages: &[crate::db::ChatMessage]) -> Vec<Message> {
    messages
        .iter()
        .skip(messages.len().saturating_sub(HISTORY_WINDOW))
        .filter_map(|message| match message.role.as_str() {
            "user" => Some(Message::user(&message.content)),
            "assistant" => Some(Message::assistant(&message.content)),
            "system" => Some(Message::system(&message.content)),
            _ => None,
        })
        .collect()
}
