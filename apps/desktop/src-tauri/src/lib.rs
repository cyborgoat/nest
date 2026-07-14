mod agent;
mod commands;
mod db;
mod debug;
mod embeddings;
mod error;
mod hub;
mod indexer;
mod llm;
mod memory;
mod retrieval;
mod state;
mod title;
mod vault;
mod vector_store;

use state::{AppState, SharedState};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

fn resolve_fixtures_root() -> PathBuf {
    // Dev: nest/fixtures/knowledge relative to CARGO_MANIFEST_DIR (apps/desktop/src-tauri)
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest.join("../../../fixtures/knowledge"),
        manifest.join("../../fixtures/knowledge"),
        PathBuf::from("fixtures/knowledge"),
    ];
    for c in candidates {
        if c.exists() {
            if let Ok(canon) = std::fs::canonicalize(&c) {
                return canon;
            }
            return c;
        }
    }
    manifest.join("../../../fixtures/knowledge")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    debug::init();

    tauri::Builder::default()
        .setup(|app| {
            nest_debug!(
                "app",
                "app_data_dir bootstrap starting"
            );
            let app_data = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            nest_debug!("app", "app_data_dir={}", app_data.display());
            let fixtures = resolve_fixtures_root();
            nest_debug!("app", "fixtures_root={}", fixtures.display());
            let state = AppState::new(app_data, fixtures)?;
            app.manage(Arc::new(state) as SharedState);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_list_tree,
            commands::vault_read_file,
            commands::settings_get,
            commands::settings_set,
            commands::settings_test_connection,
            commands::index_status,
            commands::index_rebuild,
            commands::chat_create_session,
            commands::chat_list_sessions,
            commands::chat_update_session,
            commands::chat_delete_session,
            commands::chat_generate_title,
            commands::chat_list_messages,
            commands::chat_send,
            commands::chat_cancel,
            commands::hub_list_packs,
            commands::hub_list_installed,
            commands::hub_remove_pack,
            commands::hub_download_pack,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nest");
}
