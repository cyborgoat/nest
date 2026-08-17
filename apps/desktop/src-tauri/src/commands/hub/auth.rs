//! Hub authentication commands.

use super::{
    clear_refresh_token, ensure_hub_access, store_refresh_token,
};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::hub;
use crate::state::SharedState;
use tauri::State;

#[tauri::command]
pub async fn hub_auth_state(state: State<'_, SharedState>) -> AppResult<hub::AuthState> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let _ = ensure_hub_access(state.inner(), &settings, false).await;
    let auth = state.hub_auth.lock();
    let user = auth.as_ref().map(|session| session.user.clone());
    drop(auth);
    Ok(hub::AuthState {
        authenticated: user.is_some(),
        user,
    })
}

#[tauri::command]
pub async fn hub_login(
    state: State<'_, SharedState>,
    id: String,
    password: String,
) -> AppResult<hub::AuthState> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let session = hub::login_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        id.trim(),
        &password,
    )
    .await?;
    store_refresh_token(state.inner(), &session.refresh_token);
    let user = session.user.clone();
    *state.hub_auth.lock() = Some(session);
    Ok(hub::AuthState {
        authenticated: true,
        user: Some(user),
    })
}

#[tauri::command]
pub async fn hub_register(
    state: State<'_, SharedState>,
    id: String,
    password: String,
    name: String,
) -> AppResult<hub::AuthState> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let session = hub::register_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        id.trim(),
        &password,
        name.trim(),
    )
    .await?;
    store_refresh_token(state.inner(), &session.refresh_token);
    let user = session.user.clone();
    *state.hub_auth.lock() = Some(session);
    Ok(hub::AuthState {
        authenticated: true,
        user: Some(user),
    })
}

#[tauri::command]
pub fn hub_logout(state: State<'_, SharedState>) -> AppResult<()> {
    state.hub_auth.lock().take();
    clear_refresh_token(state.inner());
    Ok(())
}

#[tauri::command]
pub async fn hub_update_profile(
    state: State<'_, SharedState>,
    name: String,
) -> AppResult<hub::HubUser> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(&state, &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to update your Hub profile"))?;
    let user = hub::update_profile_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        name.trim(),
    )
    .await?;
    if let Some(session) = state.hub_auth.lock().as_mut() {
        session.user = user.clone();
    }
    Ok(user)
}

#[tauri::command]
pub async fn hub_change_password(
    state: State<'_, SharedState>,
    current_password: String,
    new_password: String,
) -> AppResult<hub::AuthState> {
    let settings = {
        let conn = state.db.lock();
        db::get_settings(&conn)?
    };
    let token = ensure_hub_access(&state, &settings, false)
        .await?
        .ok_or_else(|| AppError::msg("Sign in to change your Hub password"))?;
    let session = hub::change_password_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &token,
        &current_password,
        &new_password,
    )
    .await?;
    store_refresh_token(state.inner(), &session.refresh_token);
    let user = session.user.clone();
    *state.hub_auth.lock() = Some(session);
    Ok(hub::AuthState {
        authenticated: true,
        user: Some(user),
    })
}

