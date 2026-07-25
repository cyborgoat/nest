export type PackVisibility = "public" | "restricted";

export type PackRelease = {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Vault folder; equals `id`. */
  path: string;
  yanked: boolean;
};

/** Hub catalog project (may have multiple SemVer releases). */
export type PackProject = {
  id: string;
  name: string;
  description: string;
  latest_version: string;
  versions: string[];
  visibility: PackVisibility;
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
export type PublishRequest = {
  id: string;
  pack_id: string;
  version: string;
  name: string;
  description: string;
  status: PublishRequestStatus;
  review_note?: string | null;
  created_at: string;
  reviewed_at?: string | null;
};

export type PendingPublishRequest = PublishRequest & {
  status: "pending";
  submitter_id: string;
  submitter_name: string;
  checksum: string;
  validation_json: string;
};

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
};

export type AdminGrant = Pick<HubUser, "uuid" | "id" | "name"> & {
  pack_id: string;
};

export type AdminMaintainer = Pick<HubUser, "uuid" | "id" | "name">;

export type AdminPack = {
  id: string;
  name: string;
  description: string;
  visibility: PackVisibility;
  archived: boolean;
  created_at: string;
  updated_at: string;
  releases: AdminRelease[];
  grants: AdminGrant[];
  maintainers: AdminMaintainer[];
};

export type SuccessResponse = { success: true };

export type InstalledPack = {
  pack_id: string;
  name: string;
  local_path: string;
  version: string;
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
  pending_request_id: string | null;
};

/** Editable metadata used when creating a knowledge pack from a local folder. */
export type KnowledgePackMeta = {
  id: string;
  name: string;
  description: string;
  version: string;
};

export type KnowledgePackDefaults = {
  metadata: KnowledgePackMeta;
  warning?: string;
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
};

/** Old (snapshot) vs. new (working) content for one file's diff view. */
export type DiffPair = {
  old: string | null;
  new: string | null;
};

export type AppSettings = {
  llm_base_url: string;
  llm_api_key: string;
  chat_model: string;
  embedding_model: string;
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
  created_at: string;
};

export type ChatSessionTitleSource = "placeholder" | "llm" | "manual";

export type ChatSession = {
  id: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  title_source: ChatSessionTitleSource;
  created_at: string;
  updated_at: string;
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
