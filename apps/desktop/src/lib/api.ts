import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  ChatMessage,
  ChatSession,
  DiffPair,
  FileStatus,
  HubConnectionStatus,
  HubAuthState,
  HubMessagePage,
  HubUnreadCount,
  HubUser,
  IndexStatus,
  InstalledPack,
  KnowledgePackDefaults,
  KnowledgePackMeta,
  LocalPackInspection,
  PackInstallConflict,
  PackProject,
  PublishRequest,
  TreeNode,
  VaultChangeMode,
  VaultChangePreview,
  VaultChangeResult,
} from "@nest/shared";

export const api = {
  vaultListTree: () => invoke<TreeNode[]>("vault_list_tree"),
  vaultReadFile: (path: string) => invoke<string>("vault_read_file", { path }),
  vaultReadImage: (path: string) =>
    invoke<string>("vault_read_image", { path }),
  vaultWriteFile: (path: string, content: string) =>
    invoke<void>("vault_write_file", { path, content }),
  vaultCreateFile: (path: string, initialContent?: string) =>
    invoke<void>("vault_create_file", {
      path,
      initialContent: initialContent ?? null,
    }),
  vaultCreateFolder: (path: string) =>
    invoke<void>("vault_create_folder", { path }),
  vaultDeleteFile: (path: string) =>
    invoke<void>("vault_delete_file", { path }),
  vaultDeleteFolder: (path: string) =>
    invoke<void>("vault_delete_folder", { path }),
  vaultRenameEntry: (from: string, to: string) =>
    invoke<void>("vault_rename_entry", { from, to }),

  hubPackChangeStatus: (packId: string) =>
    invoke<FileStatus[]>("hub_pack_change_status", { packId }),
  hubPackFileDiff: (packId: string, path: string) =>
    invoke<DiffPair>("hub_pack_file_diff", { packId, path }),
  hubPackDiscardFile: (packId: string, path: string) =>
    invoke<void>("hub_pack_discard_file", { packId, path }),

  settingsGet: () => invoke<AppSettings>("settings_get"),
  settingsPreviewKnowledgeDir: (knowledgeDir: string) =>
    invoke<VaultChangePreview>("settings_preview_knowledge_dir", {
      knowledgeDir,
    }),
  settingsChangeKnowledgeDir: (knowledgeDir: string, mode: VaultChangeMode) =>
    invoke<VaultChangeResult>("settings_change_knowledge_dir", {
      knowledgeDir,
      mode,
    }),
  settingsSet: (settings: AppSettings) =>
    invoke<void>("settings_set", { settings }),

  indexStatus: () => invoke<IndexStatus>("index_status"),
  indexRebuild: () => invoke<IndexStatus>("index_rebuild"),

  chatCreateSession: (title?: string) =>
    invoke<ChatSession>("chat_create_session", { title: title ?? null }),
  chatGetOrCreateInitialSession: () =>
    invoke<ChatSession>("chat_get_or_create_initial_session"),
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
  hubDownloadConflict: (packId: string, packName: string) =>
    invoke<PackInstallConflict | null>("hub_download_conflict", {
      packId,
      packName,
    }),
  hubDownloadPack: (
    packId: string,
    packName: string,
    version?: string,
    ownerId?: string | null,
    replaceLocalPackId?: string | null,
    syncPatch = false,
  ) =>
    invoke<InstalledPack>("hub_download_pack", {
      packId,
      packName,
      version: version ?? null,
      ownerId: ownerId ?? null,
      replaceLocalPackId: replaceLocalPackId ?? null,
      syncPatch,
    }),
  hubSyncPackPatch: (
    packId: string,
    packName: string,
    version: string,
    ownerId?: string | null,
  ) =>
    invoke<InstalledPack>("hub_download_pack", {
      packId,
      packName,
      version,
      ownerId: ownerId ?? null,
      replaceLocalPackId: null,
      syncPatch: true,
    }),
  hubInspectLocalPack: (sourcePath: string) =>
    invoke<LocalPackInspection>("hub_inspect_local_pack", { sourcePath }),
  hubImportLocalPack: (sourcePath: string, overwrite = false) =>
    invoke<InstalledPack>("hub_import_local_pack", { sourcePath, overwrite }),
  hubCreatePackFromZip: (
    sourcePath: string,
    metadata: KnowledgePackMeta,
    overwrite = false,
  ) =>
    invoke<InstalledPack>("hub_create_pack_from_zip", {
      sourcePath,
      metadata,
      overwrite,
    }),
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
  hubCreateEmptyPack: (metadata: KnowledgePackMeta) =>
    invoke<InstalledPack>("hub_create_empty_pack", { metadata }),
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
  hubPublishRelease: (packId: string, version: string) =>
    invoke<PublishRequest>("hub_publish_release", {
      packId,
      version,
    }),
  hubPublishLivePatch: (packId: string, targetVersion: string) =>
    invoke<PublishRequest>("hub_publish_live_patch", {
      packId,
      targetVersion,
    }),
  hubUpdatePackMetadata: (packId: string, description: string) =>
    invoke<InstalledPack>("hub_update_pack_metadata", {
      packId,
      description,
    }),
  hubRenamePack: (packId: string, name: string) =>
    invoke<InstalledPack>("hub_rename_pack", { packId, name }),
  hubReconcilePublishRequests: () =>
    invoke<InstalledPack[]>("hub_reconcile_publish_requests"),
  hubMergeApprovedPack: (packId: string, requestId: string) =>
    invoke<InstalledPack>("hub_merge_approved_pack", { packId, requestId }),
  hubListMessages: (filter: "all" | "unread", cursor?: string) =>
    invoke<HubMessagePage>("hub_list_messages", {
      filter,
      cursor: cursor ?? null,
    }),
  hubUnreadMessageCount: () =>
    invoke<HubUnreadCount>("hub_unread_message_count"),
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

export function listenChatSessionUpdated(
  handler: (session: ChatSession) => void,
): Promise<UnlistenFn> {
  return listen<ChatSession>("chat-session-updated", (e) => handler(e.payload));
}
