export const queryKeys = {
  tree: ["tree"] as const,
  settings: ["settings"] as const,
  index: ["index-status"] as const,
  installedPacks: ["installed-packs"] as const,
  catalog: ["packs"] as const,
  hubStatus: ["hub-status"] as const,
  hubAuth: ["hub-auth"] as const,
  publishReconcile: ["publish-reconcile"] as const,
  messages: ["hub-messages"] as const,
  messagesFor: (filter: "all" | "unread") =>
    ["hub-messages", filter] as const,
  messageCount: ["hub-message-count"] as const,
  chatSessions: ["chat-sessions"] as const,
  chatMessages: (session_id: string) =>
    ["chat-messages", session_id] as const,
  allChatMessages: ["chat-messages"] as const,
  file: (path: string) => ["file", path] as const,
  allFiles: ["file"] as const,
  vaultImage: (path: string) => ["vault-image", path] as const,
  packStatus: (packId: string) => ["pack-status", packId] as const,
  fileDiff: (packId: string, path: string) =>
    ["file-diff", packId, path] as const,
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
