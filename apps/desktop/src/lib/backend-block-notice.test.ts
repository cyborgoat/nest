import type { BackendDescriptor } from "@nest/shared";
import { describe, expect, it } from "vitest";
import { backendBlockNotice } from "./backend-block-notice";

function descriptor(
  options: Partial<BackendDescriptor>,
): BackendDescriptor {
  return {
    id: "claude",
    label: "Claude",
    enabled: true,
    availability: "unavailable",
    reason_code: null,
    message: null,
    modes: [],
    models: [],
    native_tool_profile: "test",
    knowledge_profile: "test",
    settings_target: "claude_agent",
    ...options,
  };
}

describe("backendBlockNotice", () => {
  it("splits the disabled-agent notice around a Settings link word", () => {
    const notice = backendBlockNotice(
      descriptor({ enabled: false, reason_code: "disabled" }),
    );
    expect(notice.before).toBe("Claude is disabled for this chat. Enable it in ");
    expect(notice.linkWord).toBe("Settings");
    expect(notice.after).toBe(".");
    expect(notice.settingsTarget).toBe("claude-agent");
  });

  it("splits the unverified-connection notice around a Settings link word", () => {
    const notice = backendBlockNotice(
      descriptor({ reason_code: "connection_unverified" }),
    );
    expect(notice.before).toBe(
      "Claude is not connected yet. Run Test connection in ",
    );
    expect(notice.linkWord).toBe("Settings");
    expect(notice.settingsTarget).toBe("claude-agent");
  });

  it("splits the missing CLI path notice around a Settings link word", () => {
    const notice = backendBlockNotice(descriptor({ reason_code: "cli_missing" }));
    expect(notice.before).toBe("Claude has no CLI path configured. Set it in ");
    expect(notice.linkWord).toBe("Settings");
  });

  it("keeps the reindex notice as a single sentence without a link", () => {
    const notice = backendBlockNotice(
      descriptor({
        id: "nest",
        label: "Nest Agent",
        reason_code: "reindex_required",
        settings_target: "general",
      }),
    );
    expect(notice.before).toBe(
      "Nest Agent is unavailable until the workspace is reindexed.",
    );
    expect(notice.linkWord).toBeNull();
    expect(notice.settingsTarget).toBeNull();
  });

  it("falls back to the descriptor message with the agent label", () => {
    const notice = backendBlockNotice(
      descriptor({ reason_code: "other", message: "boom" }),
    );
    expect(notice.before).toBe("Claude: boom");
    expect(notice.linkWord).toBe("Settings");
  });
});
