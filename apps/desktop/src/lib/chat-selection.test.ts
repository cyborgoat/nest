import type { BackendDescriptor } from "@nest/shared";
import { describe, expect, it } from "vitest";
import {
  capsuleFromModelSelection,
  deriveCapsules,
  isBackendUsable,
  modelSelectionFromCapsule,
} from "./chat-selection";

function descriptor(
  id: string,
  options: Partial<BackendDescriptor> = {},
): BackendDescriptor {
  return {
    id,
    label: id === "nest" ? "Nest Agent" : "Claude",
    enabled: true,
    availability: "ready",
    reason_code: null,
    message: null,
    modes: [
      { id: "ask", available: true, reason_code: null, message: null },
      { id: "agent", available: true, reason_code: null, message: null },
    ],
    models: [
      {
        selection: { kind: "default", value: null },
        label: id === "nest" ? "gpt-4o-mini" : "CLI Default (default)",
        source: "default",
      },
    ],
    native_tool_profile: "test",
    knowledge_profile: "test",
    settings_target: null,
    ...options,
  };
}

describe("isBackendUsable", () => {
  it("accepts only enabled ready or last-verified backends", () => {
    expect(isBackendUsable(descriptor("nest"))).toBe(true);
    expect(
      isBackendUsable(descriptor("claude", { availability: "last_verified" })),
    ).toBe(true);
    expect(
      isBackendUsable(descriptor("claude", { availability: "unavailable" })),
    ).toBe(false);
    expect(isBackendUsable(descriptor("claude", { enabled: false }))).toBe(false);
  });
});

describe("deriveCapsules", () => {
  it("only offers enabled descriptors unless the disabled backend is active", () => {
    const disabled = descriptor("claude", {
      enabled: false,
      availability: "unavailable",
      reason_code: "disabled",
    });
    expect(
      deriveCapsules({
        descriptors: [descriptor("nest"), disabled],
        activeBackendId: "nest",
        boundBackend: null,
      }).backends,
    ).toHaveLength(1);
    const active = deriveCapsules({
      descriptors: [descriptor("nest"), disabled],
      activeBackendId: "claude",
      boundBackend: "claude",
    });
    expect(active.backends[1].disabled).toBe(true);
    expect(active.backends[1].disabledReason).toBe("disabled");
  });

  it("hides enabled but disconnected backends unless they are active", () => {
    const disconnected = descriptor("claude", {
      availability: "unavailable",
      reason_code: "connection_unverified",
    });
    const capsules = deriveCapsules({
      descriptors: [descriptor("nest"), disconnected],
      activeBackendId: "nest",
      boundBackend: null,
    });
    expect(capsules.backends.map((backend) => backend.id)).toEqual(["nest"]);
    const bound = deriveCapsules({
      descriptors: [descriptor("nest"), disconnected],
      activeBackendId: "claude",
      boundBackend: "claude",
    });
    expect(bound.backends.map((backend) => backend.id)).toEqual([
      "nest",
      "claude",
    ]);
    expect(bound.backends[1].disabled).toBe(true);
  });

  it("derives model and mode capsules entirely from the active descriptor", () => {
    const claude = descriptor("claude", {
      models: [
        {
          selection: { kind: "default", value: null },
          label: "Opus (default)",
          source: "default",
        },
        {
          selection: { kind: "explicit", value: "sonnet" },
          label: "sonnet",
          source: "custom",
        },
      ],
      modes: [
        {
          id: "ask",
          available: false,
          reason_code: "ask_unavailable",
          message: null,
        },
        { id: "agent", available: true, reason_code: null, message: null },
      ],
    });
    const capsules = deriveCapsules({
      descriptors: [descriptor("nest"), claude],
      activeBackendId: "claude",
      boundBackend: null,
    });
    expect(capsules.models).toEqual([
      { id: "default", label: "Opus (default)" },
      { id: "sonnet", label: "sonnet" },
    ]);
    expect(capsules.modes[0]).toMatchObject({
      id: "ask",
      disabled: true,
      disabledReason: "ask_unavailable",
    });
  });

  it("locks backend selection once the session is bound", () => {
    const capsules = deriveCapsules({
      descriptors: [descriptor("nest"), descriptor("claude")],
      activeBackendId: "claude",
      boundBackend: "claude",
    });
    expect(capsules.canChangeBackend).toBe(false);
  });
});

describe("model capsule mapping", () => {
  it("round-trips default and explicit selections", () => {
    const def = { kind: "default" as const, value: null };
    expect(capsuleFromModelSelection(def)).toBe("default");
    expect(modelSelectionFromCapsule("default")).toEqual(def);

    const explicit = { kind: "explicit" as const, value: "glm-5.3" };
    expect(capsuleFromModelSelection(explicit)).toBe("glm-5.3");
    expect(modelSelectionFromCapsule("glm-5.3")).toEqual(explicit);
  });
});
