import type { ChatSession, ClaudeConnectionStatus } from "@nest/shared";

export type ComposerGate = {
  blocked: boolean;
  reason: string | null;
  reconnectable: boolean;
};

export type SessionBackendInfo = Pick<
  ChatSession,
  "backend" | "backend_status"
>;

const NOT_BLOCKED: ComposerGate = {
  blocked: false,
  reason: null,
  reconnectable: false,
};

export function claudeComposerGate(
  session: SessionBackendInfo | null,
  claudeStatus: ClaudeConnectionStatus | null,
): ComposerGate {
  if (!session || session.backend === null) {
    if (claudeStatus === "unavailable") {
      return {
        blocked: true,
        reason:
          "Claude Agent is enabled but not connected. Test the connection in Settings before chatting.",
        reconnectable: true,
      };
    }
    return NOT_BLOCKED;
  }
  if (session.backend === "nest") {
    return NOT_BLOCKED;
  }
  if (session.backend_status === "unresumable") {
    return {
      blocked: true,
      reason: "This Claude conversation can no longer be resumed. Start a new chat.",
      reconnectable: false,
    };
  }
  if (claudeStatus === "disabled") {
    return {
      blocked: true,
      reason: "Claude Agent is disabled. Re-enable it in Settings to continue this chat.",
      reconnectable: false,
    };
  }
  if (claudeStatus === "unavailable") {
    return {
      blocked: true,
      reason: "Claude connection is unavailable. Fix it in Settings to continue this chat.",
      reconnectable: true,
    };
  }
  return NOT_BLOCKED;
}

export function claudeBackendNotice(
  session: SessionBackendInfo | null,
  claudeStatus: ClaudeConnectionStatus | null,
): string | null {
  if (!session || session.backend === null) {
    return null;
  }
  const claudeUsable =
    claudeStatus === "connected" || claudeStatus === "last_connected";
  if (session.backend === "claude" && !claudeUsable) {
    return "Settings changes apply to new chats only.";
  }
  if (session.backend === "nest" && claudeUsable) {
    return "Settings changes apply to new chats only.";
  }
  return null;
}
