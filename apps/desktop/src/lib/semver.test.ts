import { describe, expect, it } from "vitest";
import { compareSemVer, nextPatchVersion } from "./semver";

describe("compareSemVer", () => {
  it("compares semantic versions numerically", () => {
    expect(compareSemVer("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemVer("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemVer("1.2.2", "1.2.3")).toBeLessThan(0);
  });

  it("accepts pre-release and build metadata", () => {
    expect(compareSemVer("1.2.3-beta.1", "1.2.3+build.2")).toBe(0);
  });

  it("falls back to lexical comparison for non-semver values", () => {
    expect(compareSemVer("next", "legacy")).toBeGreaterThan(0);
  });
});

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
