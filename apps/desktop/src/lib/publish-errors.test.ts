import { describe, expect, it } from "vitest";
import { publishErrorMessage } from "./publish-errors";

describe("publishErrorMessage", () => {
  it("uses the thrown error's own message when it has one", () => {
    expect(publishErrorMessage(new Error("Version already published"), "release")).toBe(
      "Version already published",
    );
  });

  it("falls back to a kind-specific message for a non-Error rejection", () => {
    expect(publishErrorMessage(undefined, "release")).toBe(
      "Could not publish release",
    );
    expect(publishErrorMessage(undefined, "live_patch")).toBe(
      "Could not submit live patch",
    );
  });

  it("replaces a stale-build 'no such command' error with an actionable instruction", () => {
    const staleBuildError = new Error(
      "unknown command hub_publish_live_patch",
    );
    expect(publishErrorMessage(staleBuildError, "live_patch")).toBe(
      "Restart the desktop app to enable live patch publishing",
    );
    // Same substitution regardless of which kind triggered it, since it's
    // about the installed binary being stale, not the publish kind.
    expect(publishErrorMessage(staleBuildError, "release")).toBe(
      "Restart the desktop app to enable live patch publishing",
    );
  });
});
