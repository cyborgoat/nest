mod agent;
mod chat_history;
mod commands;
mod db;
mod debug;
mod default_pack;
mod embeddings;
mod error;
mod http;
mod hub;
mod indexer;
mod indexing;
mod llm;
mod retrieval;
mod snapshot;
mod state;
mod title;
mod tray;
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
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            nest_debug!("app", "app_data_dir bootstrap starting");
            let app_data = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            nest_debug!("app", "app_data_dir={}", app_data.display());
            let state = AppState::new(app_data)?;
            app.manage(Arc::new(state) as SharedState);
            let shared_state = app.state::<SharedState>();
            if indexing::status(&shared_state)?.indexed_chunks == 0 {
                indexing::schedule(&shared_state)?;
            }
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_list_tree,
            commands::vault_read_file,
            commands::vault_read_image,
            commands::vault_write_file,
            commands::vault_create_file,
            commands::vault_create_folder,
            commands::vault_delete_file,
            commands::vault_delete_folder,
            commands::vault_rename_entry,
            commands::vault_reveal_in_folder,
            commands::vault_import_files,
            commands::hub_pack_change_status,
            commands::hub_pack_file_diff,
            commands::hub_pack_discard_file,
            commands::settings_get,
            commands::settings_preview_knowledge_dir,
            commands::settings_change_knowledge_dir,
            commands::settings_set,
            commands::index_status,
            commands::index_rebuild,
            commands::chat_create_session,
            commands::chat_get_or_create_initial_session,
            commands::chat_list_sessions,
            commands::chat_update_session,
            commands::chat_delete_session,
            commands::chat_list_messages,
            commands::chat_send,
            commands::chat_cancel,
            commands::hub_status,
            commands::hub_test_connection,
            commands::hub_list_packs,
            commands::hub_list_installed,
            commands::hub_set_pack_active,
            commands::hub_remove_pack,
            commands::hub_download_conflict,
            commands::hub_download_pack,
            commands::hub_import_local_pack,
            commands::hub_inspect_local_pack,
            commands::hub_create_pack_from_zip,
            commands::hub_read_folder_pack_defaults,
            commands::hub_create_pack_from_folder,
            commands::hub_create_empty_pack,
            commands::hub_export_pack,
            commands::hub_auth_state,
            commands::hub_login,
            commands::hub_register,
            commands::hub_logout,
            commands::hub_update_profile,
            commands::hub_change_password,
            commands::hub_publish_release,
            commands::hub_publish_live_patch,
            commands::hub_update_pack_metadata,
            commands::hub_rename_pack,
            commands::hub_reconcile_publish_requests,
            commands::hub_cancel_publish_request,
            commands::hub_merge_approved_pack,
            commands::hub_list_messages,
            commands::hub_unread_message_count,
            commands::hub_mark_message_read,
            commands::hub_mark_all_messages_read,
            commands::hub_delete_message,
            commands::hub_delete_read_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nest");
}
