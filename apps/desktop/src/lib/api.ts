import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  IndexStatus,
  InstalledPack,
  Pack,
  TreeNode,
} from "@nest/shared";

export const api = {
  vaultListTree: () => invoke<TreeNode[]>("vault_list_tree"),
  vaultReadFile: (path: string) => invoke<string>("vault_read_file", { path }),

  settingsGet: () => invoke<AppSettings>("settings_get"),
  settingsSet: (settings: AppSettings) =>
    invoke<void>("settings_set", { settings }),
  settingsTestConnection: () => invoke<string>("settings_test_connection"),

  indexStatus: () => invoke<IndexStatus>("index_status"),
  indexRebuild: () => invoke<IndexStatus>("index_rebuild"),

  chatCreateSession: (title?: string) =>
    invoke<ChatSession>("chat_create_session", { title: title ?? null }),
  chatListSessions: () => invoke<ChatSession[]>("chat_list_sessions"),
  chatUpdateSession: (
    sessionId: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ) =>
    invoke<ChatSession>("chat_update_session", { sessionId, patch }),
  chatDeleteSession: (sessionId: string) =>
    invoke<void>("chat_delete_session", { sessionId }),
  chatGenerateTitle: (sessionId: string) =>
    invoke<ChatSession>("chat_generate_title", { sessionId }),
  chatListMessages: (sessionId: string) =>
    invoke<ChatMessage[]>("chat_list_messages", { sessionId }),
  chatSend: (
    sessionId: string,
    query: string,
    scopePaths: string[],
    streamEvent: string,
  ) =>
    invoke<ChatMessage>("chat_send", {
      sessionId,
      query,
      scopePaths,
      streamEvent,
    }),
  chatCancel: () => invoke<void>("chat_cancel"),

  hubListPacks: () => invoke<Pack[]>("hub_list_packs"),
  hubListInstalled: () => invoke<InstalledPack[]>("hub_list_installed"),
  hubRemovePack: (packId: string) =>
    invoke<IndexStatus>("hub_remove_pack", { packId }),
  hubDownloadPack: (packId: string) =>
    invoke<IndexStatus>("hub_download_pack", { packId }),
};

export type ChatStreamEvent =
  | { type: "reading"; path: string }
  | { type: "generating" }
  | { type: "citations"; citations: import("@nest/shared").Citation[] }
  | { type: "token"; content: string }
  | { type: "done"; message_id: string }
  | { type: "error"; message: string };

export function listenChatStream(
  eventName: string,
  handler: (event: ChatStreamEvent) => void,
): Promise<UnlistenFn> {
  return listen<ChatStreamEvent>(eventName, (e) => handler(e.payload));
}
