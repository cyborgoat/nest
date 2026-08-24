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
pub async fn index_rebuild(state: State<'_, SharedState>) -> AppResult<IndexStatus> {
    let _slot = state
        .inner()
        .begin_operation(crate::state::OperationKind::Reindex, "workspace")?;
    indexing::schedule_and_wait(state.inner(), std::time::Duration::from_secs(300)).await
}
