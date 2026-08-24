import { describe, expect, it } from "vitest";
import type { ClaudeConnectionStatus } from "@nest/shared";
import {
  claudeBackendNotice,
  claudeComposerGate,
  type SessionBackendInfo,
} from "./claude-composer";

function session(
  backend: SessionBackendInfo["backend"],
  backendStatus: SessionBackendInfo["backend_status"] = "uninitialized",
): SessionBackendInfo {
  return { backend, backend_status: backendStatus };
}

const STATUSES: ClaudeConnectionStatus[] = [
  "disabled",
  "connected",
  "last_connected",
  "unavailable",
];

describe("claudeComposerGate", () => {
  it("never blocks Nest-bound sessions regardless of Claude state", () => {
    for (const status of STATUSES) {
      const gate = claudeComposerGate(session("nest", "ready"), status);
      expect(gate.blocked, `status=${status}`).toBe(false);
      expect(gate.reason).toBeNull();
      expect(gate.reconnectable).toBe(false);
    }
  });

  it("allows unbound sessions when Claude is disabled (first turn binds Nest)", () => {
    const gate = claudeComposerGate(session(null), "disabled");
    expect(gate.blocked).toBe(false);
  });

  it("allows unbound sessions when Claude is connected or last-connected", () => {
    expect(claudeComposerGate(session(null), "connected").blocked).toBe(false);
    expect(claudeComposerGate(session(null), "last_connected").blocked).toBe(
      false,
    );
  });

  it("blocks unbound sessions when Claude is enabled but unavailable", () => {
    const gate = claudeComposerGate(session(null), "unavailable");
    expect(gate.blocked).toBe(true);
    expect(gate.reason).toContain("not connected");
    expect(gate.reconnectable).toBe(true);
  });

  it("keeps Claude-bound sessions usable while connected", () => {
    expect(
      claudeComposerGate(session("claude", "ready"), "connected").blocked,
    ).toBe(false);
    expect(
      claudeComposerGate(session("claude", "ready"), "last_connected").blocked,
    ).toBe(false);
  });

  it("makes Claude-bound sessions read-only when disabled or unavailable", () => {
    const disabled = claudeComposerGate(session("claude", "ready"), "disabled");
    expect(disabled.blocked).toBe(true);
    expect(disabled.reason).toContain("disabled");
    expect(disabled.reconnectable).toBe(false);

    const unavailable = claudeComposerGate(
      session("claude", "ready"),
      "unavailable",
    );
    expect(unavailable.blocked).toBe(true);
    expect(unavailable.reason).toContain("unavailable");
    expect(unavailable.reconnectable).toBe(true);
  });

  it("makes unresumable Claude sessions read-only regardless of connection state", () => {
    for (const status of STATUSES) {
      const gate = claudeComposerGate(session("claude", "unresumable"), status);
      expect(gate.blocked, `status=${status}`).toBe(true);
      expect(gate.reason).toContain("no longer be resumed");
      expect(gate.reconnectable).toBe(false);
    }
  });

  it("treats a missing status as permissive while loading", () => {
    expect(claudeComposerGate(session("claude", "ready"), null).blocked).toBe(
      false,
    );
    expect(claudeComposerGate(null, "unavailable").blocked).toBe(true);
    expect(claudeComposerGate(null, null).blocked).toBe(false);
  });
});

describe("claudeBackendNotice", () => {
  it("shows the new-chats notice when the bound backend disagrees with the current default", () => {
    expect(
      claudeBackendNotice(session("claude", "ready"), "disabled"),
    ).toBe("Settings changes apply to new chats only.");
    expect(
      claudeBackendNotice(session("claude", "ready"), "unavailable"),
    ).toBe("Settings changes apply to new chats only.");
    expect(
      claudeBackendNotice(session("nest", "ready"), "connected"),
    ).toBe("Settings changes apply to new chats only.");
    expect(
      claudeBackendNotice(session("nest", "ready"), "last_connected"),
    ).toBe("Settings changes apply to new chats only.");
  });

  it("hides the notice when the bound backend matches the default", () => {
    expect(claudeBackendNotice(session("claude", "ready"), "connected")).toBeNull();
    expect(claudeBackendNotice(session("nest", "ready"), "disabled")).toBeNull();
    expect(claudeBackendNotice(session(null), "connected")).toBeNull();
    expect(claudeBackendNotice(null, "unavailable")).toBeNull();
  });
});
