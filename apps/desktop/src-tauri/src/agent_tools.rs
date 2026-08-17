//! Permissioned, turn-local Markdown tools for Agent chat mode.

use crate::chat_events::ChatStreamEvent;
use crate::db::{self, InstalledPack, NewChatFileChange};
use crate::error::{AppError, AppResult};
use crate::state::SharedState;
use crate::vault;
use parking_lot::Mutex;
use rig::tool::Tool;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const MAX_CHANGED_FILES: usize = 32;
const MAX_FILE_BYTES: usize = 256 * 1024;
const MAX_STAGED_BYTES: usize = 2 * 1024 * 1024;
const MAX_LISTED_FILES: usize = 500;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct AgentToolError(String);

impl From<AppError> for AgentToolError {
    fn from(value: AppError) -> Self {
        Self(value.to_string())
    }
}

#[derive(Debug, Clone)]
struct StagedFile {
    original: Option<String>,
    current: Option<String>,
}

#[derive(Debug)]
struct EditWorkspace {
    protected_paths: HashSet<String>,
    staged: BTreeMap<String, StagedFile>,
}

#[derive(Clone)]
pub struct AgentToolContext {
    state: SharedState,
    app: AppHandle,
    stream_event: String,
    workspace: Arc<Mutex<EditWorkspace>>,
}

impl AgentToolContext {
    pub fn new(
        state: SharedState,
        app: AppHandle,
        stream_event: String,
        protected_paths: Vec<String>,
    ) -> Self {
        Self {
            state,
            app,
            stream_event,
            workspace: Arc::new(Mutex::new(EditWorkspace {
                protected_paths: protected_paths.into_iter().collect(),
                staged: BTreeMap::new(),
            })),
        }
    }

    pub fn list_tool(&self) -> ListVaultFiles {
        ListVaultFiles(self.clone())
    }

    pub fn read_tool(&self) -> ReadVaultFile {
        ReadVaultFile(self.clone())
    }

    pub fn replace_tool(&self) -> ReplaceVaultFile {
        ReplaceVaultFile(self.clone())
    }

    pub fn create_tool(&self) -> CreateVaultFile {
        CreateVaultFile(self.clone())
    }

    pub fn delete_tool(&self) -> DeleteVaultFile {
        DeleteVaultFile(self.clone())
    }

    fn emit(&self, event: ChatStreamEvent) {
        let _ = self.app.emit(&self.stream_event, event);
    }

    fn installed_pack_for_path(&self, path: &str) -> AppResult<InstalledPack> {
        let candidate = Path::new(path);
        let conn = self.state.db.lock();
        db::list_sync_state(&conn)?
            .into_iter()
            .filter(|pack| pack.active)
            .find(|pack| {
                let root = Path::new(&pack.local_path);
                candidate.starts_with(root) && candidate != root
            })
            .ok_or_else(|| AppError::msg(format!("Path is not inside an active pack: {path}")))
    }

    fn ensure_editable(&self, path: &str) -> AppResult<InstalledPack> {
        if !vault::is_markdown_path(path) {
            return Err(AppError::msg(
                "Agent tools can only edit Markdown (.md) files",
            ));
        }
        if self.workspace.lock().protected_paths.contains(path) {
            return Err(AppError::msg(format!(
                "{path} is open in the editor and cannot be changed by Agent"
            )));
        }
        ensure_no_symlink_components(&self.state.vault_path(), path)?;
        let pack = self.installed_pack_for_path(path)?;
        // Shared review lock with vault/hub file commands; agent additionally
        // enforces origin/owner below (stricter than vault writes).
        crate::commands::ensure_pack_not_review_locked(&pack)?;
        let user = self
            .state
            .hub_auth
            .lock()
            .as_ref()
            .map(|session| session.user.clone());
        let permitted = match pack.origin.as_str() {
            "local" => true,
            "registry" => user.as_ref().is_some_and(|user| {
                user.role == "admin"
                    || user.role == "superuser"
                    || pack.owner_id.as_deref() == Some(user.id.as_str())
            }),
            _ => false,
        };
        if !permitted {
            return Err(AppError::msg(format!(
                "You do not have edit access to {}",
                pack.name
            )));
        }
        Ok(pack)
    }

    fn read_current(&self, path: &str) -> AppResult<String> {
        if let Some(staged) = self.workspace.lock().staged.get(path) {
            return staged
                .current
                .clone()
                .ok_or_else(|| AppError::msg(format!("{path} is staged for deletion")));
        }
        self.installed_pack_for_path(path)?;
        if let Some(pending) = {
            let conn = self.state.db.lock();
            db::get_pending_chat_file_change_for_path(&conn, path)?
        } {
            return pending
                .new_content
                .ok_or_else(|| AppError::msg(format!("{path} is pending deletion")));
        }
        vault::read_file(&self.state.vault_path(), path)
    }

    fn stage(
        &self,
        path: String,
        next: Option<String>,
        require: StageRequirement,
    ) -> AppResult<()> {
        self.ensure_editable(&path)?;
        if next
            .as_ref()
            .is_some_and(|content| content.len() > MAX_FILE_BYTES)
        {
            return Err(AppError::msg(format!(
                "Agent file size limit exceeded for {path} (256 KiB)"
            )));
        }
        let vault_root = self.state.vault_path();
        let disk_original = vault::read_file(&vault_root, &path).ok();
        let pending = {
            let conn = self.state.db.lock();
            db::get_pending_chat_file_change_for_path(&conn, &path)?
        };
        if let Some(pending) = &pending {
            if pending.old_content != disk_original {
                return Err(AppError::msg(format!(
                    "{path} changed after its pending Agent proposal was created"
                )));
            }
        }
        let mut workspace = self.workspace.lock();
        let previous = workspace.staged.get(&path).cloned();
        let effective_exists = previous
            .as_ref()
            .map(|entry| entry.current.is_some())
            .unwrap_or_else(|| {
                pending
                    .as_ref()
                    .map(|change| change.new_content.is_some())
                    .unwrap_or(disk_original.is_some())
            });
        match require {
            StageRequirement::Existing if !effective_exists => {
                return Err(AppError::msg(format!("{path} does not exist")));
            }
            StageRequirement::Missing if effective_exists => {
                return Err(AppError::msg(format!("{path} already exists")));
            }
            _ => {}
        }
        if !workspace.staged.contains_key(&path) && workspace.staged.len() >= MAX_CHANGED_FILES {
            return Err(AppError::msg("Agent turn may change at most 32 files"));
        }
        let original = workspace
            .staged
            .get(&path)
            .map(|entry| entry.original.clone())
            .unwrap_or_else(|| {
                pending
                    .as_ref()
                    .map(|change| change.old_content.clone())
                    .unwrap_or(disk_original)
            });
        workspace.staged.insert(
            path.clone(),
            StagedFile {
                original,
                current: next,
            },
        );
        let total = workspace
            .staged
            .values()
            .filter_map(|entry| entry.current.as_ref())
            .map(String::len)
            .sum::<usize>();
        if total > MAX_STAGED_BYTES {
            match previous {
                Some(entry) => {
                    workspace.staged.insert(path, entry);
                }
                None => {
                    workspace.staged.remove(&path);
                }
            }
            return Err(AppError::msg("Agent staged-content limit exceeded (2 MiB)"));
        }
        Ok(())
    }

    pub fn proposals(&self) -> AppResult<Vec<NewChatFileChange>> {
        let entries = self.workspace.lock().staged.clone();
        let mut changes = entries.into_iter().collect::<Vec<_>>();
        if changes.is_empty() {
            return Ok(Vec::new());
        }

        let root = self.state.vault_path();
        for (path, entry) in &changes {
            self.ensure_editable(path)?;
            let current = vault::read_file(&root, path).ok();
            if current != entry.original {
                return Err(AppError::msg(format!(
                    "{path} changed while Agent was working; no Agent changes were applied"
                )));
            }
        }

        changes.sort_by(|a, b| a.0.cmp(&b.0));
        Ok(changes
            .into_iter()
            .map(|(path, entry)| NewChatFileChange {
                operation: match (&entry.original, &entry.current) {
                    (None, Some(_)) => "created",
                    (Some(_), None) => "deleted",
                    _ => "modified",
                }
                .to_string(),
                path,
                old_content: entry.original,
                new_content: entry.current,
            })
            .collect())
    }

    pub fn apply_change(&self, change: &db::ChatFileChangeDetail) -> AppResult<()> {
        self.ensure_editable(&change.path)?;
        let root = self.state.vault_path();
        let current = vault::read_file(&root, &change.path).ok();
        if current != change.old_content {
            return Err(AppError::msg(format!(
                "{} changed after the Agent proposal was created; review it again before applying",
                change.path
            )));
        }
        match &change.new_content {
            Some(content) => vault::write_file(&root, &change.path, content),
            None => vault::delete_file(&root, &change.path),
        }
    }
}

pub fn rollback_changes(state: &SharedState, changes: &[NewChatFileChange]) {
    let originals = changes
        .iter()
        .map(|change| (change.path.clone(), change.old_content.clone()))
        .collect::<Vec<_>>();
    rollback_files(&state.vault_path(), &originals);
}

fn rollback_files(root: &Path, files: &[(String, Option<String>)]) {
    for (path, original) in files.iter().rev() {
        match original {
            Some(content) => {
                let _ = vault::write_file(root, path, content);
            }
            None => {
                let _ = vault::delete_file(root, path);
            }
        }
    }
}

fn ensure_no_symlink_components(root: &Path, rel_path: &str) -> AppResult<()> {
    let mut probe = root.to_path_buf();
    for component in Path::new(rel_path).components() {
        probe.push(component);
        if let Ok(metadata) = fs::symlink_metadata(&probe) {
            if metadata.file_type().is_symlink() {
                return Err(AppError::msg(
                    "Agent tools cannot edit through symbolic links",
                ));
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum StageRequirement {
    Existing,
    Missing,
}

#[derive(Deserialize)]
pub struct PathArgs {
    path: String,
}

#[derive(Deserialize)]
pub struct WriteArgs {
    path: String,
    content: String,
}

#[derive(Deserialize)]
pub struct ListArgs {
    #[serde(default)]
    query: String,
}

#[derive(Serialize)]
pub struct FileList {
    files: Vec<String>,
    truncated: bool,
}

#[derive(Clone)]
pub struct ListVaultFiles(AgentToolContext);

impl Tool for ListVaultFiles {
    const NAME: &'static str = "list_vault_files";
    type Error = AgentToolError;
    type Args = ListArgs;
    type Output = FileList;

    fn description(&self) -> String {
        "List Markdown files in active Nest knowledge packs. Use the optional query to filter paths.".into()
    }
    fn parameters(&self) -> serde_json::Value {
        json!({"type":"object","properties":{"query":{"type":"string"}},"required":[]})
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let roots = {
            let conn = self.0.state.db.lock();
            db::list_sync_state(&conn)
                .map_err(AgentToolError::from)?
                .into_iter()
                .filter(|pack| pack.active)
                .map(|pack| pack.local_path)
                .collect::<Vec<_>>()
        };
        let query = args.query.to_ascii_lowercase();
        let mut files = Vec::new();
        for node in vault::list_tree(&self.0.state.vault_path()).map_err(AgentToolError::from)? {
            collect_markdown_paths(&node, &roots, &query, &mut files);
            if files.len() >= MAX_LISTED_FILES {
                break;
            }
        }
        let pending_changes = {
            let conn = self.0.state.db.lock();
            db::list_pending_chat_file_changes(&conn).map_err(AgentToolError::from)?
        };
        for change in pending_changes {
            let path = change.path;
            if change.new_content.is_none() {
                files.retain(|listed| listed != &path);
                continue;
            }
            if roots.iter().any(|root| Path::new(&path).starts_with(root))
                && (query.is_empty() || path.to_ascii_lowercase().contains(&query))
                && !files.contains(&path)
            {
                files.push(path);
            }
        }
        files.sort();
        let truncated = files.len() >= MAX_LISTED_FILES;
        files.truncate(MAX_LISTED_FILES);
        Ok(FileList { files, truncated })
    }
}

fn collect_markdown_paths(
    node: &vault::TreeNode,
    roots: &[String],
    query: &str,
    output: &mut Vec<String>,
) {
    if output.len() >= MAX_LISTED_FILES {
        return;
    }
    if matches!(node.kind, vault::TreeNodeKind::File)
        && vault::is_markdown_path(&node.path)
        && roots
            .iter()
            .any(|root| Path::new(&node.path).starts_with(root))
        && (query.is_empty() || node.path.to_ascii_lowercase().contains(query))
    {
        output.push(node.path.clone());
    }
    if let Some(children) = &node.children {
        for child in children {
            collect_markdown_paths(child, roots, query, output);
        }
    }
}

#[derive(Clone)]
pub struct ReadVaultFile(AgentToolContext);
impl Tool for ReadVaultFile {
    const NAME: &'static str = "read_vault_file";
    type Error = AgentToolError;
    type Args = PathArgs;
    type Output = String;
    fn description(&self) -> String {
        "Read one Markdown file from an active Nest knowledge pack, including edits staged earlier in this turn.".into()
    }
    fn parameters(&self) -> serde_json::Value {
        path_schema()
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.emit(ChatStreamEvent::Reading {
            path: args.path.clone(),
        });
        self.0
            .read_current(&args.path)
            .map_err(AgentToolError::from)
    }
}

#[derive(Clone)]
pub struct ReplaceVaultFile(AgentToolContext);
impl Tool for ReplaceVaultFile {
    const NAME: &'static str = "replace_vault_file";
    type Error = AgentToolError;
    type Args = WriteArgs;
    type Output = String;
    fn description(&self) -> String {
        "Replace the complete content of an existing editable Markdown file. Read it first and preserve unrelated content.".into()
    }
    fn parameters(&self) -> serde_json::Value {
        write_schema()
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        stage_edit(&self.0, args, StageRequirement::Existing, "modified")
    }
}

#[derive(Clone)]
pub struct CreateVaultFile(AgentToolContext);
impl Tool for CreateVaultFile {
    const NAME: &'static str = "create_vault_file";
    type Error = AgentToolError;
    type Args = WriteArgs;
    type Output = String;
    fn description(&self) -> String {
        "Create a new Markdown file inside an editable active pack. The file must not already exist.".into()
    }
    fn parameters(&self) -> serde_json::Value {
        write_schema()
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        stage_edit(&self.0, args, StageRequirement::Missing, "created")
    }
}

fn stage_edit(
    context: &AgentToolContext,
    args: WriteArgs,
    requirement: StageRequirement,
    operation: &str,
) -> Result<String, AgentToolError> {
    context.emit(ChatStreamEvent::FileEditing {
        path: args.path.clone(),
        operation: operation.into(),
    });
    context
        .stage(args.path.clone(), Some(args.content), requirement)
        .map_err(AgentToolError::from)?;
    context.emit(ChatStreamEvent::FileStaged {
        path: args.path.clone(),
        operation: operation.into(),
    });
    Ok(format!("Staged {operation}: {}", args.path))
}

#[derive(Clone)]
pub struct DeleteVaultFile(AgentToolContext);
impl Tool for DeleteVaultFile {
    const NAME: &'static str = "delete_vault_file";
    type Error = AgentToolError;
    type Args = PathArgs;
    type Output = String;
    fn description(&self) -> String {
        "Delete one existing editable Markdown file. This cannot delete folders or whole packs."
            .into()
    }
    fn parameters(&self) -> serde_json::Value {
        path_schema()
    }
    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        self.0.emit(ChatStreamEvent::FileEditing {
            path: args.path.clone(),
            operation: "deleted".into(),
        });
        self.0
            .stage(args.path.clone(), None, StageRequirement::Existing)
            .map_err(AgentToolError::from)?;
        self.0.emit(ChatStreamEvent::FileStaged {
            path: args.path.clone(),
            operation: "deleted".into(),
        });
        Ok(format!("Staged deletion: {}", args.path))
    }
}

fn path_schema() -> serde_json::Value {
    json!({"type":"object","properties":{"path":{"type":"string","description":"Vault-relative Markdown path including pack root"}},"required":["path"]})
}

fn write_schema() -> serde_json::Value {
    json!({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]})
}
