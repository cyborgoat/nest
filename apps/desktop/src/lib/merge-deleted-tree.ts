import type { TreeNode } from "@nest/shared";

/**
 * Deleted files don't exist on disk, so `vault_list_tree`'s filesystem walk
 * never surfaces them — but the file tree still needs to show a "D" row for
 * them. This inserts a synthetic file node (and any synthetic parent folders
 * needed to hold it) for every deleted path under `root`, without mutating
 * the input tree.
 */
export function mergeDeletedIntoTree(
  root: TreeNode,
  deletedPaths: string[],
): TreeNode {
  const relevant = deletedPaths.filter(
    (p) => p === root.path || p.startsWith(`${root.path}/`),
  );
  if (relevant.length === 0) return root;

  const cloned = cloneWithChildren(root);
  for (const path of relevant) {
    insertSyntheticFile(cloned, path);
  }
  return cloned;
}

function cloneWithChildren(node: TreeNode): TreeNode {
  return {
    ...node,
    children: node.children?.map(cloneWithChildren),
  };
}

function insertSyntheticFile(root: TreeNode, fullPath: string) {
  const relative = fullPath.slice(root.path.length + 1);
  if (!relative) return;
  const segments = relative.split("/");

  let cursor = root;
  let cursorPath = root.path;
  for (let i = 0; i < segments.length - 1; i++) {
    cursorPath = `${cursorPath}/${segments[i]}`;
    cursor.children ??= [];
    let child = cursor.children.find(
      (c) => c.path === cursorPath && c.kind === "folder",
    );
    if (!child) {
      child = { name: segments[i], path: cursorPath, kind: "folder", children: [] };
      cursor.children.push(child);
      cursor.children.sort((a, b) => a.name.localeCompare(b.name));
    }
    cursor = child;
  }

  const fileName = segments[segments.length - 1];
  cursor.children ??= [];
  if (!cursor.children.some((c) => c.path === fullPath)) {
    cursor.children.push({ name: fileName, path: fullPath, kind: "file" });
    cursor.children.sort((a, b) => a.name.localeCompare(b.name));
  }
}
