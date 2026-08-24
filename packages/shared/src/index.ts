export type PackVisibility = "public" | "restricted";

export type PackRelease = {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Vault folder; equals `id`. */
  path: string;
  yanked: boolean;
  patch_revision: number;
  patched_at: string | null;
};

export type PackReleaseSummary = Pick<
  PackRelease,
  "version" | "yanked" | "patch_revision" | "patched_at"
>;

/** Public attribution for the account credited with creating a Hub pack. */
export type PackAuthor = Pick<HubUser, "id" | "name">;

/** Hub catalog project (may have multiple SemVer releases). */
export type PackProject = {
  id: string;
  name: string;
  description: string;
  latest_version: string;
  versions: string[];
  releases: PackReleaseSummary[];
  visibility: PackVisibility;
  /** The first user whose publish request created this pack. */
  author: PackAuthor | null;
  /** Accounts currently allowed to publish updates to this pack. */
  maintainers: PackAuthor[];
  /** The requesting user's own login id, echoed back only if they're one of
   *  this pack's maintainers (a pack can have several) — null otherwise.
   *  Personalized per-request; not "the owner." */
  owner_id: string | null;
};

export type UserRole = "user" | "admin" | "superuser";
export type HubUser = {
  uuid: string;
  id: string;
  name: string;
  role: UserRole;
  managed: boolean;
};
export type HubAuthState = { authenticated: boolean; user: HubUser | null };
export type HubSession = {
  user: HubUser;
  access_token: string;
  refresh_token: string;
  expires_in: number;
};
export type PublishRequestStatus = "pending" | "approved" | "rejected";
export type PublishRequestType = "release" | "live_patch";
export type PublishRequest = {
  id: string;
  pack_id: string;
  version: string;
  name: string;
  description: string;
  commit_message: string;
  status: PublishRequestStatus;
  request_type: PublishRequestType;
  patch_revision: number | null;
  base_patch_revision: number | null;
  review_note?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  /** Present when the viewer is allowed to inspect this pack's review. */
  submitter_id?: string | null;
  submitter_name?: string | null;
};

export type PendingPublishRequest = PublishRequest & {
  status: "pending";
  submitter_id: string;
  submitter_name: string;
  checksum: string;
  validation_json: string;
};

export type AdminPublishRequest = PublishRequest & {
  checksum: string;
  validation_json: string;
  submitter_id: string | null;
  submitter_name: string | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
};

export type AdminPublishHistoryPage = {
  items: AdminPublishRequest[];
  next_cursor: string | null;
};

export type PublishReviewFileStatus = "added" | "modified" | "deleted";
export type PublishReviewFileKind = "text" | "image" | "binary";

export type PublishReviewFile = {
  path: string;
  status: PublishReviewFileStatus;
  kind: PublishReviewFileKind;
  old_size: number | null;
  new_size: number | null;
  old_sha256: string | null;
  new_sha256: string | null;
  additions: number | null;
  deletions: number | null;
  inline_available: boolean;
  inline_unavailable_reason: string | null;
};

export type PublishReviewSummary = {
  changed_files: number;
  added_files: number;
  modified_files: number;
  deleted_files: number;
  additions: number;
  deletions: number;
};

export type AdminPublishReviewDetail = AdminPublishRequest & {
  base_version: string | null;
  diff_available: boolean;
  diff_unavailable_reason: string | null;
  summary: PublishReviewSummary;
  files: PublishReviewFile[];
};

export type PublishReviewDiffLine = {
  type: "context" | "added" | "deleted";
  old_line: number | null;
  new_line: number | null;
  content: string;
};

export type PublishReviewTextDiff = {
  kind: "text";
  path: string;
  lines: PublishReviewDiffLine[];
};

export type PublishReviewImageDiff = {
  kind: "image";
  path: string;
  old_available: boolean;
  new_available: boolean;
};

export type PublishReviewBinaryDiff = {
  kind: "binary";
  path: string;
  reason: string;
};

export type PublishReviewFileDetail =
  PublishReviewTextDiff | PublishReviewImageDiff | PublishReviewBinaryDiff;

export type PackPendingStatus = { pending: PublishRequest | null };

export type HubMessageKind =
  "publish_submitted" | "publish_approved" | "publish_rejected";
export type HubMessage = {
  id: string;
  kind: HubMessageKind;
  title: string;
  body: string;
  pack_id: string | null;
  publish_request_id: string | null;
  read_at: string | null;
  created_at: string;
};
export type HubMessagePage = {
  items: HubMessage[];
  next_cursor: string | null;
};
export type HubUnreadCount = { count: number };

export type AdminUser = HubUser & {
  created_at: string;
  updated_at: string;
};

export type AdminRelease = {
  pack_id: string;
  version: string;
  yanked: boolean;
  checksum: string;
  published_at: string;
  patch_revision: number;
  patched_at: string | null;
};

export type AdminGrant = Pick<HubUser, "uuid" | "id" | "name"> & {
  pack_id: string;
};

export type AdminMaintainer = Pick<HubUser, "uuid" | "id" | "name">;

export type AdminPack = {
  id: string;
  name: string;
  description: string;
  /** Highest non-yanked SemVer release, or null when none is installable. */
  latest_version: string | null;
  visibility: PackVisibility;
  archived: boolean;
  created_at: string;
  updated_at: string;
  releases: AdminRelease[];
  grants: AdminGrant[];
  author: AdminMaintainer | null;
  maintainers: AdminMaintainer[];
};

export type RegistryResyncIssue = {
  /** Path relative to the configured registry root. */
  path: string;
  message: string;
};

export type RegistryResyncResult = {
  completed_at: string;
  packs_added: string[];
  packs_updated: string[];
  packs_removed: string[];
  releases_added: string[];
  releases_updated: string[];
  releases_removed: string[];
  issues: RegistryResyncIssue[];
};

export type InstalledPack = {
  pack_id: string;
  name: string;
  local_path: string;
  version: string;
  patch_revision: number;
  last_synced: string | null;
  active: boolean;
  origin: "local" | "registry" | "bundled" | "unknown";
  /** The signed-in user's own Hub login id, echoed back only if they're one
   *  of this pack's maintainers — not "the owner" (a pack can have several
   *  maintainers). Null if they aren't one, or the origin has no hub-side
   *  owner at all. Purely a can-I-edit-this flag, not for display. */
  owner_id: string | null;
  description: string;
  /** Version of an unresolved publish request for this pack, if any. `version`
   *  above stays at the last-approved value while this is set. */
  pending_version: string | null;
  pending_request_type: PublishRequestType | null;
  pending_patch_revision: number | null;
  pending_request_id: string | null;
  /** Resolution state for the locally tracked publish request. Approved
   * requests stay actionable until their exact Hub release is merged. */
  publish_review_status: "pending" | "approved_awaiting_merge" | null;
  publish_review_created_at: string | null;
  /** Whether the signed-in user submitted and may cancel the pending request. */
  pending_can_cancel: boolean;
  pending_submitter_id?: string | null;
  pending_submitter_name?: string | null;
};

export type PackMergeChoice = "local" | "approved";

export type PackMergeConflict = {
  path: string;
  kind: "text" | "image" | "binary";
  local_exists: boolean;
  approved_exists: boolean;
  local_preview?: string | null;
  approved_preview?: string | null;
};

export type PackMergePreview = {
  pack_id: string;
  version: string;
  patch_revision: number;
  request_id: string | null;
  conflicts: PackMergeConflict[];
  merged_file_count: number;
  preview_token: string;
};

export type PackMergeResolution = {
  path: string;
  choice: PackMergeChoice;
};

export type PackInstallConflict = {
  pack_id: string;
  name: string;
  local_path: string;
  version: string;
};

export type VaultChangeMode = "move" | "delete_and_seed_defaults";

export type VaultChangePreview = {
  current_path: string;
  target_path: string;
  managed_pack_count: number;
};

export type VaultChangeResult = {
  settings: AppSettings;
  cleanup_warning: string | null;
};

export type VaultTransferOperation = "copy" | "move";
export type VaultConflictPolicy = "error" | "replace" | "skip";

export type VaultTransferConflict = {
  source_path: string;
  destination_path: string;
  kind: "file" | "type_mismatch";
};

export type VaultTransferPreview = {
  conflicts: VaultTransferConflict[];
  eligible_count: number;
  skipped: string[];
};

export type VaultTransferResult = {
  written_files: string[];
  created_folders: string[];
  removed_paths: string[];
  replaced_paths: string[];
  skipped: string[];
};

/** Editable metadata used when creating a knowledge pack from a folder or ZIP. */
export type KnowledgePackMeta = {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Detected sub-path within an inspected folder/ZIP; absent on input. */
  path?: string;
};

export type KnowledgePackDefaults = {
  metadata: KnowledgePackMeta;
  warning?: string;
};

export type LocalPackInspection = {
  metadata: KnowledgePackMeta;
  needs_metadata: boolean;
};

export type TreeNodeKind = "folder" | "file";

export type TreeNode = {
  name: string;
  path: string;
  kind: TreeNodeKind;
  children?: TreeNode[];
};

/** Per-file local-version-control status, relative to a pack's last snapshot. */
export type FileChangeStatus = "modified" | "new" | "deleted";

export type FileStatus = {
  path: string;
  status: FileChangeStatus;
  kind: "text" | "image" | "binary";
};

export type TextDiffPair = {
  kind: "text";
  old: string | null;
  new: string | null;
};

export type ImageDiffPair = {
  kind: "image";
  old: string | null;
  new: string | null;
};

export type BinaryDiffSide = {
  size: number;
  checksum: string;
};

export type BinaryDiffPair = {
  kind: "binary";
  old: BinaryDiffSide | null;
  new: BinaryDiffSide | null;
};

/** Old (snapshot) vs. new (working) content for one file's diff view. */
export type DiffPair = TextDiffPair | ImageDiffPair | BinaryDiffPair;

export type AppSettings = {
  llm_base_url: string;
  llm_api_key: string;
  chat_model: string;
  hub_base_url: string;
  /** Optional HTTP(S)/SOCKS5 proxy for Hub and related outbound requests. Empty = direct. */
  proxy_url: string;
  /** When false, Nest connects directly and ignores `proxy_url`. */
  proxy_enabled: boolean;
  /** Root UI font size in points. */
  font_size_pt: number;
  /** UI display language, separate from runtime knowledge logic. */
  display_language: "en";
  /** Custom vault path; empty = default under app data. */
  knowledge_dir: string;
  /** Absolute path currently used for packs (read-only from UI). */
  resolved_knowledge_dir: string;
  claude_agent_enabled: boolean;
  claude_cli_path: string;
  claude_custom_models: string;
};

export type GeneralSettingsUpdate = Omit<
  AppSettings,
  "claude_agent_enabled" | "claude_cli_path" | "claude_custom_models"
>;

export type ClaudeConnectionStatus =
  | "disabled"
  | "connected"
  | "last_connected"
  | "unavailable";

export type ClaudeConnectionReport = {
  status: ClaudeConnectionStatus;
  configured_cli_path: string;
  resolved_cli_path: string;
  cli_version: string;
  effective_model: string;
  tested_at: string;
  message: string | null;
};

export type ClaudeSettingsRequest = {
  enabled: boolean;
  cliPath: string;
  customModels: string;
};

export type ClaudeDetectionDto = {
  configured_path: string;
  resolved_path: string;
  spawn_strategy: string;
  cli_version: string | null;
};

export type ClaudeModelOption = {
  model_id: string;
  source: "default" | "observed" | "custom";
};

export type ToolActivityRow = {
  id: string;
  turn_id: string;
  sequence: number;
  source: string;
  kind: string;
  status: string;
  label: string;
  target: string | null;
  started_at: string;
  finished_at: string | null;
};

export type WorkspaceHealth = {
  reindex_required: boolean;
  reason: string | null;
  updated_at: string | null;
};

export type Citation = {
  chunk_id: string;
  file_path: string;
  title: string;
  snippet: string;
  score: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  thinking?: string;
  thinking_seconds?: number;
  file_changes?: ChatFileChangeSummary[];
  created_at: string;
  turn_id?: string | null;
};

export type ChatMode = "ask" | "agent";
export type ChatFileOperation = "created" | "modified" | "deleted";
export type ChatFileChangeSummary = {
  id: string;
  path: string;
  operation: ChatFileOperation;
  status: "pending" | "approved" | "rejected" | "conflicted" | "resolved_external" | "failed";
};
export type ChatFileChangeDetail = ChatFileChangeSummary & {
  old_content: string | null;
  new_content: string | null;
  rebase_count?: number;
  last_rebased_at?: string | null;
  resolution_reason?: string | null;
};

export type ChatBackend = string;
export type ChatBackendStatus = "uninitialized" | "ready" | "unresumable";

export type ModelSelectionKind = "default" | "explicit";

export type ModelSelection = {
  kind: ModelSelectionKind;
  value: string | null;
};

export type BackendAvailability =
  | "checking"
  | "ready"
  | "last_verified"
  | "unavailable";

export type BackendModeDescriptor = {
  id: ChatMode;
  available: boolean;
  reason_code: string | null;
  message: string | null;
};

export type BackendModelDescriptor = {
  selection: ModelSelection;
  label: string;
  source: string;
};

export type BackendDescriptor = {
  id: ChatBackend;
  label: string;
  enabled: boolean;
  availability: BackendAvailability;
  reason_code: string | null;
  message: string | null;
  modes: BackendModeDescriptor[];
  models: BackendModelDescriptor[];
  native_tool_profile: string;
  knowledge_profile: string;
  settings_target: string | null;
};

export type AppOperationStatus = {
  kind:
    | "chat_turn"
    | "connection_probe"
    | "save_claude_settings"
    | "reindex"
    | "vault_switch"
    | "delete_session";
  owner: string;
  started_at: string;
};

export type ChatSessionTitleSource = "placeholder" | "llm" | "manual" | "local";

export type ChatSession = {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  title_source: ChatSessionTitleSource;
  mode: ChatMode;
  created_at: string;
  updated_at: string;
  backend: ChatBackend | null;
  backend_status: ChatBackendStatus;
  selected_backend_id: ChatBackend | null;
  selected_model: ModelSelection;
  selection_revision: number;
};

export type IndexStatus = {
  indexed_files: number;
  indexed_chunks: number;
  is_indexing: boolean;
  last_indexed_at: string | null;
  message: string | null;
};

export type HubConnectionStatus = {
  online: boolean;
  hub_base_url: string;
  message: string | null;
};
