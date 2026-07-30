import { describe, expect, it } from "vitest";
import { pendingPublishVersionLabel } from "@/lib/publish-request-labels";

describe("pendingPublishVersionLabel", () => {
  it("identifies a live patch and its revision", () => {
    expect(
      pendingPublishVersionLabel({
        pending_version: "1.0.0",
        pending_request_type: "live_patch",
        pending_patch_revision: 3,
      }),
    ).toBe("v1.0.0 · Patch 3");
  });

  it("keeps release labels concise", () => {
    expect(
      pendingPublishVersionLabel({
        pending_version: "2.0.0",
        pending_request_type: "release",
        pending_patch_revision: null,
      }),
    ).toBe("v2.0.0");
  });
});
