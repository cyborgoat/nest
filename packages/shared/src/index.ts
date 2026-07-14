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

/** @deprecated Prefer PackProject / PackRelease */
export type Pack = PackRelease;

export type InstalledPack = {
  pack_id: string;
  name: string;
  local_path: string;
  version: string;
  last_synced: string | null;
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
