import { describe, expect, it } from "vitest";
import type { PackProject } from "@nest/shared";
import { publishDescriptionDefault } from "@/lib/publish-defaults";

const latestRelease: PackProject = {
  id: "handbook",
  name: "Handbook",
  description: "Description from the latest release",
  latest_version: "2.0.0",
  versions: ["2.0.0", "1.0.0"],
  releases: [
    {
      version: "2.0.0",
      yanked: false,
      patch_revision: 0,
      patched_at: null,
    },
    {
      version: "1.0.0",
      yanked: false,
      patch_revision: 0,
      patched_at: null,
    },
  ],
  visibility: "public",
  owner_id: "owner",
};

describe("publishDescriptionDefault", () => {
  it("uses the latest Hub release description when available", () => {
    expect(publishDescriptionDefault(latestRelease, "Local description")).toBe(
      "Description from the latest release",
    );
  });

  it("falls back to local metadata for a first or offline publish", () => {
    expect(publishDescriptionDefault(undefined, "Local description")).toBe(
      "Local description",
    );
  });
});
