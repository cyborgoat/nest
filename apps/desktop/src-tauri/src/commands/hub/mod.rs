//! Hub-registry commands: pack browsing/install, source-control-style
//! status/diff/discard against the pack snapshot baseline, auth, publish
//! workflow, and Hub message inbox.

mod auth;
mod messages;
mod packs;
mod source_control;

pub use auth::*;
pub use messages::*;
pub use packs::*;
pub use source_control::*;

use crate::db::{self, AppSettings, InstalledPack};
use crate::error::{AppError, AppResult};
use crate::hub;
use crate::state::SharedState;

/// Look up an installed pack by id, or fail with a consistent error message.
/// Shared by every command that needs "the pack, or a clear error" before
/// doing anything else.
fn require_installed_pack(conn: &rusqlite::Connection, pack_id: &str) -> AppResult<InstalledPack> {
    let pack_id = pack_id.trim();
    db::get_sync_state(conn, pack_id)?
        .ok_or_else(|| AppError::msg(format!("Pack not installed: {pack_id}")))
}

fn ensure_existing_pack_not_review_locked(
    conn: &rusqlite::Connection,
    pack_id: &str,
) -> AppResult<()> {
    if let Some(pack) = db::get_sync_state(conn, pack_id.trim())? {
        super::ensure_pack_not_review_locked(&pack)?;
    }
    Ok(())
}

/// Persist the Hub refresh token in the local `settings` table — the same
/// storage and guarantees as everything else in Settings (e.g.
/// `llm_api_key`), not the OS keychain. Errors are logged rather than
/// propagated — a failed write shouldn't fail login itself, but it must not
/// be swallowed silently either, since a silent failure here is
/// indistinguishable from "never logged in" on the next launch.
///
/// This used to go through the OS keychain, but on an ad-hoc-signed build
/// (no Apple Developer Team ID, `signingIdentity: "-"` in tauri.conf.json)
/// macOS does not reliably persist Keychain items across process launches —
/// `SecItemAdd` can report success while the item is unreadable by the very
/// next launch of the same binary — which made the Hub session silently
/// fail to survive an app restart.
fn store_refresh_token(state: &SharedState, refresh_token: &str) {
    let conn = state.db.lock();
    match db::set_hub_refresh_token(&conn, Some(refresh_token)) {
        Ok(()) => crate::nest_debug!("hub", "stored refresh token in settings"),
        Err(error) => crate::nest_debug!("hub", "failed to store refresh token: {error}"),
    }
}

fn clear_refresh_token(state: &SharedState) {
    let conn = state.db.lock();
    if let Err(error) = db::set_hub_refresh_token(&conn, None) {
        crate::nest_debug!("hub", "failed to clear refresh token: {error}");
    }
}

fn load_refresh_token(state: &SharedState) -> Option<String> {
    let conn = state.db.lock();
    match db::get_hub_refresh_token(&conn) {
        Ok(Some(token)) => {
            crate::nest_debug!("hub", "loaded refresh token from settings");
            Some(token)
        }
        Ok(None) => {
            crate::nest_debug!("hub", "no refresh token in settings");
            None
        }
        Err(error) => {
            crate::nest_debug!("hub", "failed to read refresh token: {error}");
            None
        }
    }
}

async fn ensure_hub_access(
    state: &SharedState,
    settings: &AppSettings,
    force_refresh: bool,
) -> AppResult<Option<String>> {
    let _refresh_guard = state.hub_auth_refresh.lock().await;
    let session = state.hub_auth.lock().clone();
    let session = match session {
        Some(session) => session,
        None => {
            let Some(refresh) = load_refresh_token(state) else {
                return Ok(None);
            };
            let restored = match hub::refresh_remote(
                &settings.hub_base_url,
                settings.effective_proxy_url(),
                &refresh,
            )
            .await
            {
                Ok(value) => value,
                Err(error) => {
                    // Only a definitive rejection (401: the refresh token is
                    // actually invalid/expired) should sign the user out.
                    // Anything else — offline at launch, Hub briefly down,
                    // a timeout — is transient, and wiping the stored
                    // refresh token here would silently force a fresh login
                    // on every relaunch that happens to race the network.
                    if error.is_unauthorized() {
                        crate::nest_debug!(
                            "hub",
                            "stored refresh token rejected, clearing it: {error}"
                        );
                        clear_refresh_token(state);
                    } else {
                        crate::nest_debug!(
                            "hub",
                            "session restore failed, keeping stored refresh token for retry: {error}"
                        );
                    }
                    return Ok(None);
                }
            };
            // The Hub rotates refresh tokens on every use — the one just
            // exchanged above is now revoked server-side, so `restored`
            // carries a brand-new one that must be persisted immediately.
            // Skipping this meant every cold start silently burned the
            // stored token without saving its replacement, so only the
            // *first* relaunch after login ever worked — the next one
            // presented an already-revoked token and got signed out.
            store_refresh_token(state, &restored.refresh_token);
            *state.hub_auth.lock() = Some(restored.clone());
            restored
        }
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if !force_refresh && session.expires_at_epoch > now + 30 {
        return Ok(Some(session.access_token));
    }
    let refreshed = match hub::refresh_remote(
        &settings.hub_base_url,
        settings.effective_proxy_url(),
        &session.refresh_token,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            *state.hub_auth.lock() = None;
            if error.is_unauthorized() {
                crate::nest_debug!("hub", "refresh token rejected, clearing it: {error}");
                clear_refresh_token(state);
            } else {
                crate::nest_debug!(
                    "hub",
                    "token refresh failed, keeping stored refresh token for retry: {error}"
                );
            }
            return Ok(None);
        }
    };
    store_refresh_token(state, &refreshed.refresh_token);
    let token = refreshed.access_token.clone();
    *state.hub_auth.lock() = Some(refreshed);
    Ok(Some(token))
}
