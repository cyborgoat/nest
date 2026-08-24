use crate::error::AppResult;
use crate::state::SharedState;
use tauri::State;

#[tauri::command]
pub fn app_operation_status(
    state: State<'_, SharedState>,
) -> Option<crate::state::OperationStatus> {
    state.operation_status()
}

#[tauri::command]
pub fn workspace_health(
    state: State<'_, SharedState>,
) -> AppResult<crate::vault_reconciliation::WorkspaceHealth> {
    Ok(crate::vault_reconciliation::load_health(&state))
}

#[tauri::command]
pub async fn workspace_reindex(
    state: State<'_, SharedState>,
) -> AppResult<crate::vault_reconciliation::WorkspaceHealth> {
    let _slot = state
        .inner()
        .begin_operation(crate::state::OperationKind::Reindex, "workspace")?;
    crate::vault_reconciliation::restore_workspace(&state, std::time::Duration::from_secs(300))
        .await
}
