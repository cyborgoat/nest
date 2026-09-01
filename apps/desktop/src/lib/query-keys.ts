const PACK_STATUS_KEY = "pack-status";
const FILE_DIFF_KEY = "file-diff";

export const queryKeys = {
  tree: ["tree"] as const,
  settings: ["settings"] as const,
  index: ["index-status"] as const,
  installedPacks: ["installed-packs"] as const,
  catalog: ["packs"] as const,
  hubStatus: ["hub-status"] as const,
  claudeConnection: ["claude-connection"] as const,
  workspaceHealth: ["workspace-health"] as const,
  appOperation: ["app-operation"] as const,
  chatBackendDescriptors: ["chat-backend-descriptors"] as const,
  claudeModelOptions: ["claude-model-options"] as const,
  claudeModelStatuses: ["claude-model-statuses"] as const,
  hubAuth: ["hub-auth"] as const,
  publishReconcile: ["publish-reconcile"] as const,
  messages: ["hub-messages"] as const,
  messagesFor: (filter: "all" | "unread") =>
    ["hub-messages", filter] as const,
  sourceControlRejections: [
    "hub-messages",
    "source-control-rejections",
  ] as const,
  messageCount: ["hub-message-count"] as const,
  chatSessions: ["chat-sessions"] as const,
  chatMessages: (session_id: string) =>
    ["chat-messages", session_id] as const,
  chatFileChange: (changeId: string) => ["chat-file-change", changeId] as const,
  pendingChatFileChange: (path: string) => ["pending-chat-file-change", path] as const,
  allPendingChatFileChanges: ["pending-chat-file-change"] as const,
  allChatMessages: ["chat-messages"] as const,
  file: (path: string) => ["file", path] as const,
  allFiles: ["file"] as const,
  vaultImage: (path: string) => ["vault-image", path] as const,
  packStatus: (packId: string) => [PACK_STATUS_KEY, packId] as const,
  /** Prefix key matching every pack's status query, for a broad invalidation
   * (e.g. after publishing/reconciling) that isn't scoped to one pack. */
  allPackStatus: [PACK_STATUS_KEY] as const,
  fileDiff: (packId: string, path: string) =>
    [FILE_DIFF_KEY, packId, path] as const,
  /** Prefix key matching every diff query for one pack, regardless of path. */
  packFileDiffs: (packId: string) => [FILE_DIFF_KEY, packId] as const,
};

export const packMutationInvalidations = [
  queryKeys.tree,
  queryKeys.index,
  queryKeys.installedPacks,
  queryKeys.allFiles,
  queryKeys.allChatMessages,
] as const;

/**
 * Invalidated after any single-file mutation (save/create/delete/rename/
 * discard). Pass `path` when the mutation touched one specific, still-open
 * file (e.g. a save or a discard) so only that file's content re-fetches —
 * otherwise every open file's content query would refetch on every edit
 * anywhere in the vault.
 */
export function fileMutationInvalidations(packId: string, path?: string) {
  return [
    queryKeys.tree,
    queryKeys.packStatus(packId),
    ...(path ? [queryKeys.file(path)] : []),
  ] as const;
}
