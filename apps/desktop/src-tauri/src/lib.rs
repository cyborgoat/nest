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
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    debug::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            nest_debug!("app", "app_data_dir bootstrap starting");
            let app_data = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            nest_debug!("app", "app_data_dir={}", app_data.display());
            let state = AppState::new(app_data)?;
            app.manage(Arc::new(state) as SharedState);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_list_tree,
            commands::vault_read_file,
            commands::settings_get,
            commands::settings_set,
            commands::index_status,
            commands::index_rebuild,
            commands::chat_create_session,
            commands::chat_list_sessions,
            commands::chat_update_session,
            commands::chat_delete_session,
            commands::chat_list_messages,
            commands::chat_send,
            commands::chat_cancel,
            commands::hub_status,
            commands::hub_list_packs,
            commands::hub_list_installed,
            commands::hub_set_pack_active,
            commands::hub_remove_pack,
            commands::hub_download_pack,
            commands::hub_import_local_pack,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nest");
}
