import type { BackendDescriptor } from "@nest/shared";

export type BackendBlockNotice = {
  before: string;
  linkWord: string | null;
  after: string;
  settingsTarget: "claude-agent" | "general" | null;
};

const CLAUDE_LABEL = "Claude";

export function backendBlockNotice(
  descriptor: BackendDescriptor,
): BackendBlockNotice {
  const label = descriptor.id === "claude" ? CLAUDE_LABEL : descriptor.label;
  const reason = descriptor.reason_code ?? "";
  const target: "claude-agent" | "general" | null =
    descriptor.settings_target === "claude_agent"
      ? "claude-agent"
      : descriptor.settings_target === "general"
        ? "general"
        : null;

  if (!descriptor.enabled) {
    return {
      before: `${label} is disabled for this chat. Enable it in `,
      linkWord: "Settings",
      after: ".",
      settingsTarget: target,
    };
  }
  switch (reason) {
    case "cli_missing":
      return {
        before: `${label} has no CLI path configured. Set it in `,
        linkWord: "Settings",
        after: ".",
        settingsTarget: target,
      };
    case "connection_unverified":
      return {
        before: `${label} is not connected yet. Run Test connection in `,
        linkWord: "Settings",
        after: ".",
        settingsTarget: target,
      };
    case "reindex_required":
      return {
        before: `${label} is unavailable until the workspace is reindexed.`,
        linkWord: null,
        after: "",
        settingsTarget: null,
      };
    case "unknown_backend":
      return {
        before: `${label} is not installed in this build. Start a new chat with an available agent.`,
        linkWord: null,
        after: "",
        settingsTarget: null,
      };
    default:
      return {
        before: descriptor.message
          ? `${label}: ${descriptor.message}`
          : `${label} is unavailable.`,
        linkWord: target ? "Settings" : null,
        after: "",
        settingsTarget: target,
      };
  }
}

export function backendBlockNoticeFromReason(
  reason: string,
): BackendBlockNotice | null {
  return {
    before: reason,
    linkWord: null,
    after: "",
    settingsTarget: null,
  };
}
