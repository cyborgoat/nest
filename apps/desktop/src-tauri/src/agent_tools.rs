use crate::chat_events::ChatStreamEvent;
use crate::db::NewChatFileChange;
use crate::error::AppResult;
use crate::knowledge_workspace::{CapabilityMode, KnowledgeWorkspace};
use crate::state::SharedState;
use parking_lot::Mutex;
use rig::tool::Tool;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct AgentToolError(String);

impl From<crate::knowledge_workspace::KnowledgeError> for AgentToolError {
    fn from(value: crate::knowledge_workspace::KnowledgeError) -> Self {
        Self(value.to_string())
    }
}

impl From<crate::error::AppError> for AgentToolError {
    fn from(value: crate::error::AppError) -> Self {
        Self(value.to_string())
    }
}

#[derive(Clone)]
pub struct AgentToolContext {
    app: AppHandle,
    stream_event: String,
    workspace: Arc<Mutex<KnowledgeWorkspace>>,
}

impl AgentToolContext {
    pub fn new(
        state: SharedState,
        app: AppHandle,
        stream_event: String,
        protected_paths: Vec<String>,
    ) -> Self {
        Self {
            app,
            stream_event,
            workspace: Arc::new(Mutex::new(KnowledgeWorkspace::open_turn(
                state,
                CapabilityMode::Agent,
                protected_paths,
            ))),
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

    pub fn proposals(&self) -> AppResult<Vec<NewChatFileChange>> {
        self.workspace.lock().finish()
    }
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
    query: Option<String>,
}

#[derive(Serialize)]
pub struct FileList {
    pub files: Vec<String>,
    pub truncated: bool,
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
        let result = self.0.workspace.lock().list(args.query.as_deref())?;
        Ok(FileList {
            files: result.files,
            truncated: result.truncated,
        })
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
        let result = self.0.workspace.lock().read(&args.path)?;
        if result.truncated {
            return Ok(format!("{}…\n[truncated at 256 KiB]", result.content));
        }
        Ok(result.content)
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
        stage_edit(&self.0, args, EditRequirement::Existing, "modified")
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
        stage_edit(&self.0, args, EditRequirement::Missing, "created")
    }
}

enum EditRequirement {
    Existing,
    Missing,
}

fn stage_edit(
    context: &AgentToolContext,
    args: WriteArgs,
    requirement: EditRequirement,
    operation: &str,
) -> Result<String, AgentToolError> {
    context.emit(ChatStreamEvent::FileEditing {
        path: args.path.clone(),
        operation: operation.into(),
    });
    let result = {
        let mut workspace = context.workspace.lock();
        match requirement {
            EditRequirement::Existing => workspace.replace(&args.path, &args.content),
            EditRequirement::Missing => workspace.create(&args.path, &args.content),
        }
    }?;
    context.emit(ChatStreamEvent::FileStaged {
        path: args.path.clone(),
        operation: operation.into(),
    });
    Ok(result)
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
        let result = self.0.workspace.lock().delete(&args.path)?;
        self.0.emit(ChatStreamEvent::FileStaged {
            path: args.path.clone(),
            operation: "deleted".into(),
        });
        Ok(result)
    }
}

fn path_schema() -> serde_json::Value {
    json!({"type":"object","properties":{"path":{"type":"string","description":"Vault-relative Markdown path including pack root"}},"required":["path"]})
}

fn write_schema() -> serde_json::Value {
    json!({"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]})
}
