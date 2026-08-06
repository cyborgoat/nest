import { describe, expect, it } from "vitest";
import { hasPublishableChanges } from "@/lib/publish-changes";

const defaults = {
  isFirstPublish: false,
  hasFileChanges: false,
  requestType: "release" as const,
  currentDescription: "Current description",
  description: "Current description",
};

describe("hasPublishableChanges", () => {
  it("rejects a version-only release and an unchanged live patch", () => {
    expect(hasPublishableChanges(defaults)).toBe(false);
    expect(
      hasPublishableChanges({ ...defaults, requestType: "live_patch" }),
    ).toBe(false);
  });

  it("accepts content changes and release metadata changes", () => {
    expect(
      hasPublishableChanges({ ...defaults, hasFileChanges: true }),
    ).toBe(true);
    expect(
      hasPublishableChanges({ ...defaults, description: "Updated purpose" }),
    ).toBe(true);
  });

  it("allows a first publish and fails open while status is unavailable", () => {
    expect(
      hasPublishableChanges({ ...defaults, isFirstPublish: true }),
    ).toBe(true);
    expect(
      hasPublishableChanges({ ...defaults, hasFileChanges: undefined }),
    ).toBe(true);
  });
});
