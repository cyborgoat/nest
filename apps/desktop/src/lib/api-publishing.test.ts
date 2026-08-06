import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { api } from "@/lib/api";

describe("publishing command contracts", () => {
  beforeEach(() => invoke.mockReset());

  it("uses the release-only Tauri command", async () => {
    await api.hubPublishRelease("handbook", "2.0.0", "Expand setup guide");

    expect(invoke).toHaveBeenCalledWith("hub_publish_release", {
      packId: "handbook",
      version: "2.0.0",
      commitMessage: "Expand setup guide",
    });
  });

  it("uses the live-patch-only Tauri command with an explicit target", async () => {
    await api.hubPublishLivePatch(
      "handbook",
      "1.0.0",
      "Correct broken image links",
    );

    expect(invoke).toHaveBeenCalledWith("hub_publish_live_patch", {
      packId: "handbook",
      targetVersion: "1.0.0",
      commitMessage: "Correct broken image links",
    });
  });

  it("cancels the exact pending request for a pack", async () => {
    await api.hubCancelPublishRequest("handbook", "request-1");

    expect(invoke).toHaveBeenCalledWith("hub_cancel_publish_request", {
      packId: "handbook",
      requestId: "request-1",
    });
  });
});
