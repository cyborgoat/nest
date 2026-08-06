import type { TreeNode } from "@nest/shared";
import { describe, expect, it } from "vitest";
import {
  destinationFolderForNode,
  validateVaultDrop,
  type VaultDragEntry,
} from "./tree-drag-drop";

const source: VaultDragEntry = {
  kind: "file",
  name: "note.md",
  path: "source/docs/note.md",
};

function node(path: string, kind: "file" | "folder" = "folder"): TreeNode {
  return { path, kind, name: path.split("/").pop() ?? path };
}

function validate(
  target: TreeNode,
  overrides: Partial<Parameters<typeof validateVaultDrop>[0]> = {},
) {
  return validateVaultDrop({
    source,
    target,
    sourceEditable: true,
    destinationEditable: true,
    targetExists: true,
    existingPaths: new Set(),
    ...overrides,
  });
}

describe("destinationFolderForNode", () => {
  it("uses a folder directly and a file's parent", () => {
    expect(destinationFolderForNode(node("pack/docs"))).toBe("pack/docs");
    expect(destinationFolderForNode(node("pack/docs/a.md", "file"))).toBe(
      "pack/docs",
    );
  });
});

describe("validateVaultDrop", () => {
  it("builds a destination path for a valid move", () => {
    expect(validate(node("destination/guides"))).toEqual({
      valid: true,
      destinationFolder: "destination/guides",
      destinationPath: "destination/guides/note.md",
    });
  });

  it("requires edit access to both packs", () => {
    expect(
      validate(node("destination"), { sourceEditable: false }),
    ).toMatchObject({ valid: false });
    expect(
      validate(node("destination"), { destinationEditable: false }),
    ).toMatchObject({ valid: false });
  });

  it("rejects synthetic deleted targets", () => {
    expect(
      validate(node("destination/deleted"), { targetExists: false }),
    ).toMatchObject({ valid: false });
  });

  it("rejects a no-op and an existing destination", () => {
    expect(validate(node("source/docs"))).toMatchObject({ valid: false });
    expect(
      validate(node("destination"), {
        existingPaths: new Set(["destination/note.md"]),
      }),
    ).toMatchObject({ valid: false });
  });

  it("rejects moving a folder onto itself or a descendant", () => {
    const folder = {
      kind: "folder" as const,
      name: "docs",
      path: "source/docs",
    };
    expect(validate(node("source/docs"), { source: folder })).toMatchObject({
      valid: false,
    });
    expect(
      validate(node("source/docs/nested"), { source: folder }),
    ).toMatchObject({ valid: false });
  });
});
