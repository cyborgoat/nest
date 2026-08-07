//! Search index status/rebuild — thin wrappers around `crate::indexing`.

use crate::db::IndexStatus;
use crate::error::AppResult;
use crate::indexing;
use crate::state::SharedState;
use tauri::State;

#[tauri::command]
pub fn index_status(state: State<'_, SharedState>) -> AppResult<IndexStatus> {
    indexing::status(state.inner())
}

#[tauri::command]
pub fn index_rebuild(state: State<'_, SharedState>) -> AppResult<IndexStatus> {
    indexing::schedule(state.inner())
}
