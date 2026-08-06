import type { TreeNode } from "@nest/shared";
import { joinPath, parentDir } from "@/lib/vault-paths";

export type VaultDragEntry = Pick<TreeNode, "kind" | "name" | "path">;

export type VaultDropValidation =
  | { valid: true; destinationFolder: string; destinationPath: string }
  | { valid: false; reason: string };

export function destinationFolderForNode(node: TreeNode): string {
  return node.kind === "folder" ? node.path : parentDir(node.path);
}

export function validateVaultDrop({
  source,
  target,
  sourceEditable,
  destinationEditable,
  targetExists,
  existingPaths,
}: {
  source: VaultDragEntry;
  target: TreeNode;
  sourceEditable: boolean;
  destinationEditable: boolean;
  targetExists: boolean;
  existingPaths: ReadonlySet<string>;
}): VaultDropValidation {
  if (!targetExists) {
    return {
      valid: false,
      reason: "Deleted items cannot be used as move destinations.",
    };
  }
  if (!sourceEditable || !destinationEditable) {
    return {
      valid: false,
      reason: "You need edit access to both knowledge packs.",
    };
  }

  const destinationFolder = destinationFolderForNode(target);
  const destinationPath = joinPath(destinationFolder, source.name);

  if (destinationFolder === parentDir(source.path)) {
    return { valid: false, reason: "This item is already in that folder." };
  }
  if (
    source.kind === "folder" &&
    (destinationFolder === source.path ||
      destinationFolder.startsWith(`${source.path}/`))
  ) {
    return {
      valid: false,
      reason: "A folder cannot be moved inside itself.",
    };
  }
  if (existingPaths.has(destinationPath)) {
    return {
      valid: false,
      reason: `${source.name} already exists in that folder.`,
    };
  }

  return { valid: true, destinationFolder, destinationPath };
}
