export const queryKeys = {
  tree: ["tree"] as const,
  settings: ["settings"] as const,
  index: ["index-status"] as const,
  installedPacks: ["installed-packs"] as const,
  catalog: ["packs"] as const,
  hubStatus: ["hub-status"] as const,
  hubAuth: ["hub-auth"] as const,
  publishRequests: ["publish-requests"] as const,
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
};

export const packMutationInvalidations = [
  queryKeys.tree,
  queryKeys.index,
  queryKeys.installedPacks,
  queryKeys.allFiles,
  queryKeys.allChatMessages,
] as const;
