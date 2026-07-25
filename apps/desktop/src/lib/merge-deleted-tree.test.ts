import type { TreeNode } from "@nest/shared";
import { describe, expect, it } from "vitest";
import { mergeDeletedIntoTree } from "./merge-deleted-tree";

const pack: TreeNode = {
  name: "sample-pack",
  path: "sample-pack",
  kind: "folder",
  children: [
    { name: "keep.md", path: "sample-pack/keep.md", kind: "file" },
    {
      name: "docs",
      path: "sample-pack/docs",
      kind: "folder",
      children: [
        { name: "a.md", path: "sample-pack/docs/a.md", kind: "file" },
      ],
    },
  ],
};

describe("mergeDeletedIntoTree", () => {
  it("returns the same tree when nothing is deleted", () => {
    expect(mergeDeletedIntoTree(pack, [])).toEqual(pack);
  });

  it("ignores deleted paths outside this pack root", () => {
    const merged = mergeDeletedIntoTree(pack, ["other-pack/gone.md"]);
    expect(merged).toEqual(pack);
  });

  it("inserts a synthetic file into an existing folder", () => {
    const merged = mergeDeletedIntoTree(pack, ["sample-pack/docs/gone.md"]);
    const docs = merged.children?.find((c) => c.path === "sample-pack/docs");
    expect(docs?.children?.map((c) => c.path)).toEqual([
      "sample-pack/docs/a.md",
      "sample-pack/docs/gone.md",
    ]);
  });

  it("creates synthetic parent folders when the whole folder was deleted", () => {
    const merged = mergeDeletedIntoTree(pack, [
      "sample-pack/removed-dir/nested/gone.md",
    ]);
    const removedDir = merged.children?.find(
      (c) => c.path === "sample-pack/removed-dir",
    );
    expect(removedDir?.kind).toBe("folder");
    const nested = removedDir?.children?.find(
      (c) => c.path === "sample-pack/removed-dir/nested",
    );
    expect(nested?.children?.map((c) => c.path)).toEqual([
      "sample-pack/removed-dir/nested/gone.md",
    ]);
  });

  it("does not mutate the input tree", () => {
    const before = JSON.stringify(pack);
    mergeDeletedIntoTree(pack, ["sample-pack/docs/gone.md"]);
    expect(JSON.stringify(pack)).toBe(before);
  });

  it("does not duplicate an entry already present in the working tree", () => {
    const merged = mergeDeletedIntoTree(pack, ["sample-pack/keep.md"]);
    const paths = merged.children?.map((c) => c.path);
    expect(paths?.filter((p) => p === "sample-pack/keep.md")).toHaveLength(1);
  });
});
