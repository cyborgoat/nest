import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  HubConnectionStatus,
  HubAuthState,
  HubMessagePage,
  HubUser,
  IndexStatus,
  InstalledPack,
  KnowledgePackDefaults,
  KnowledgePackMeta,
  PackProject,
  PublishRequest,
  TreeNode,
} from "@nest/shared";

export const api = {
  vaultListTree: () => invoke<TreeNode[]>("vault_list_tree"),
  vaultReadFile: (path: string) => invoke<string>("vault_read_file", { path }),
  vaultReadImage: (path: string) =>
    invoke<string>("vault_read_image", { path }),

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
  ) => invoke<ChatSession>("chat_update_session", { sessionId, patch }),
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
  hubTestConnection: (hubBaseUrl: string, proxyUrl?: string) =>
    invoke<HubConnectionStatus>("hub_test_connection", {
      hubBaseUrl,
      proxyUrl: proxyUrl ?? null,
    }),
  hubListInstalled: () => invoke<InstalledPack[]>("hub_list_installed"),
  hubSetPackActive: (packId: string, active: boolean) =>
    invoke<void>("hub_set_pack_active", { packId, active }),
  hubRemovePack: (packId: string) =>
    invoke<void>("hub_remove_pack", { packId }),
  hubDownloadPack: (packId: string, version?: string) =>
    invoke<InstalledPack>("hub_download_pack", {
      packId,
      version: version ?? null,
    }),
  hubInspectLocalPack: (sourcePath: string) =>
    invoke<KnowledgePackMeta>("hub_inspect_local_pack", { sourcePath }),
  hubImportLocalPack: (sourcePath: string, overwrite = false) =>
    invoke<InstalledPack>("hub_import_local_pack", { sourcePath, overwrite }),
  hubReadFolderPackDefaults: (sourcePath: string) =>
    invoke<KnowledgePackDefaults>("hub_read_folder_pack_defaults", {
      sourcePath,
    }),
  hubCreatePackFromFolder: (
    sourcePath: string,
    metadata: KnowledgePackMeta,
    overwrite = false,
  ) =>
    invoke<InstalledPack>("hub_create_pack_from_folder", {
      sourcePath,
      metadata,
      overwrite,
    }),
  hubExportPack: (packId: string, destinationPath: string) =>
    invoke<void>("hub_export_pack", { packId, destinationPath }),
  hubAuthState: () => invoke<HubAuthState>("hub_auth_state"),
  hubLogin: (id: string, password: string) =>
    invoke<HubAuthState>("hub_login", { id, password }),
  hubRegister: (id: string, password: string, name: string) =>
    invoke<HubAuthState>("hub_register", { id, password, name }),
  hubLogout: () => invoke<void>("hub_logout"),
  hubUpdateProfile: (name: string) =>
    invoke<HubUser>("hub_update_profile", { name }),
  hubChangePassword: (currentPassword: string, newPassword: string) =>
    invoke<HubAuthState>("hub_change_password", {
      currentPassword,
      newPassword,
    }),
  hubPublishPack: (packId: string) =>
    invoke<PublishRequest>("hub_publish_pack", { packId }),
  hubListPublishRequests: () =>
    invoke<PublishRequest[]>("hub_list_publish_requests"),
  hubListMessages: (filter: "all" | "unread", cursor?: string) =>
    invoke<HubMessagePage>("hub_list_messages", {
      filter,
      cursor: cursor ?? null,
    }),
  hubUnreadMessageCount: () =>
    invoke<{ count: number }>("hub_unread_message_count"),
  hubMarkMessageRead: (messageId: string) =>
    invoke<void>("hub_mark_message_read", { messageId }),
  hubMarkAllMessagesRead: () => invoke<void>("hub_mark_all_messages_read"),
  hubDeleteMessage: (messageId: string) =>
    invoke<void>("hub_delete_message", { messageId }),
  hubDeleteReadMessages: () => invoke<void>("hub_delete_read_messages"),
};

export type ChatStreamEvent =
  | { type: "reading"; path: string }
  | { type: "generating" }
  | { type: "citations"; citations: import("@nest/shared").Citation[] }
  | { type: "thinking"; content: string }
  | { type: "token"; content: string }
  | { type: "done"; message_id: string }
  | { type: "error"; message: string };

export function listenChatStream(
  eventName: string,
  handler: (event: ChatStreamEvent) => void,
): Promise<UnlistenFn> {
  return listen<ChatStreamEvent>(eventName, (e) => handler(e.payload));
}
