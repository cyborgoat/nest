export type PackRelease = {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Vault folder; equals `id`. */
  path: string;
  yanked?: boolean;
};

/** Hub catalog project (may have multiple SemVer releases). */
export type PackProject = {
  id: string;
  name: string;
  description: string;
  latest_version: string;
  versions: string[];
};

export type InstalledPack = {
  pack_id: string;
  name: string;
  local_path: string;
  version: string;
  last_synced: string | null;
  active: boolean;
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

export type AppSettings = {
  llm_base_url: string;
  llm_api_key: string;
  chat_model: string;
  embedding_model: string;
  hub_base_url: string;
  /** Display name for the local user. */
  user_name: string;
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
