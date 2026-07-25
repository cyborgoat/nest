import { describe, expect, it } from "vitest";
import { nextPatchVersion } from "./semver";

describe("nextPatchVersion", () => {
  it("bumps the patch segment", () => {
    expect(nextPatchVersion("1.2.3")).toBe("1.2.4");
    expect(nextPatchVersion("0.1.0")).toBe("0.1.1");
  });

  it("ignores pre-release/build metadata when bumping", () => {
    expect(nextPatchVersion("1.2.3-beta.1")).toBe("1.2.4");
  });

  it("returns the input unchanged when it isn't recognizable semver", () => {
    expect(nextPatchVersion("not-a-version")).toBe("not-a-version");
  });
});
