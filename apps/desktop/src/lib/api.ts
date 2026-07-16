import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  HubConnectionStatus,
  IndexStatus,
  InstalledPack,
  PackProject,
  TreeNode,
} from "@nest/shared";

export const api = {
  vaultListTree: () => invoke<TreeNode[]>("vault_list_tree"),
  vaultReadFile: (path: string) => invoke<string>("vault_read_file", { path }),
  vaultReadImage: (path: string) => invoke<string>("vault_read_image", { path }),

  settingsGet: () => invoke<AppSettings>("settings_get"),
  settingsSet: (settings: AppSettings) =>
    invoke<void>("settings_set", { settings }),

  indexStatus: () => invoke<IndexStatus>("index_status"),

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
  chatListMessages: (sessionId: string) =>
    invoke<ChatMessage[]>("chat_list_messages", { sessionId }),
  chatSend: (
    sessionId: string,
    query: string,
    focusPaths: string[],
    streamEvent: string,
  ) =>
    invoke<ChatMessage>("chat_send", {
      sessionId,
      query,
      focusPaths,
      streamEvent,
    }),
  chatCancel: () => invoke<void>("chat_cancel"),

  hubListPacks: () => invoke<PackProject[]>("hub_list_packs"),
  hubStatus: () => invoke<HubConnectionStatus>("hub_status"),
  hubListInstalled: () => invoke<InstalledPack[]>("hub_list_installed"),
  hubSetPackActive: (packId: string, active: boolean) =>
    invoke<void>("hub_set_pack_active", { packId, active }),
  hubRemovePack: (packId: string) =>
    invoke<IndexStatus>("hub_remove_pack", { packId }),
  hubDownloadPack: (packId: string, version?: string) =>
    invoke<IndexStatus>("hub_download_pack", {
      packId,
      version: version ?? null,
    }),
  hubImportLocalPack: (sourcePath: string) =>
    invoke<IndexStatus>("hub_import_local_pack", { sourcePath }),
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
