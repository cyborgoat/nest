//! Hub inbox / message commands.

use super::ensure_hub_access;
use crate::db::{self, AppSettings};
use crate::error::{AppError, AppResult};
use crate::hub;
use crate::state::SharedState;
use tauri::State;

async fn hub_message_context(state: &SharedState) -> AppResult<(AppSettings, String)> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(state, &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to view Hub messages"))?;
    Ok((settings, token))
}

#[tauri::command]
pub async fn hub_list_messages(
    state: State<'_, SharedState>,
    filter: String,
    cursor: Option<String>,
) -> AppResult<hub::HubMessagePage> {
    let (settings, token) = hub_message_context(state.inner()).await?;
    hub::list_messages_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        &filter,
        cursor.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn hub_unread_message_count(
    state: State<'_, SharedState>,
) -> AppResult<hub::UnreadCount> {
    let (settings, token) = hub_message_context(state.inner()).await?;
    hub::unread_count_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
    )
    .await
}

async fn mutate_hub_message(
    state: &SharedState,
    method: reqwest::Method,
    path: &str,
) -> AppResult<()> {
    let (settings, token) = hub_message_context(state).await?;
    hub::mutate_message_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        method,
        path,
    )
    .await
}

#[tauri::command]
pub async fn hub_mark_message_read(
    state: State<'_, SharedState>,
    message_id: String,
) -> AppResult<()> {
    mutate_hub_message(
        state.inner(),
        reqwest::Method::PATCH,
        &format!("/{}/read", message_id),
    )
    .await
}

#[tauri::command]
pub async fn hub_mark_all_messages_read(state: State<'_, SharedState>) -> AppResult<()> {
    mutate_hub_message(state.inner(), reqwest::Method::POST, "/read-all").await
}

#[tauri::command]
pub async fn hub_delete_message(
    state: State<'_, SharedState>,
    message_id: String,
) -> AppResult<()> {
    mutate_hub_message(
        state.inner(),
        reqwest::Method::DELETE,
        &format!("/{}", message_id),
    )
    .await
}

#[tauri::command]
pub async fn hub_delete_read_messages(state: State<'_, SharedState>) -> AppResult<()> {
    mutate_hub_message(state.inner(), reqwest::Method::DELETE, "/read").await
}
