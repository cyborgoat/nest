export type Pack = {
  id: string;
  name: string;
  description: string;
  version: string;
  path: string;
};

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

export type ChatSession = {
  id: string;
  title: string;
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
