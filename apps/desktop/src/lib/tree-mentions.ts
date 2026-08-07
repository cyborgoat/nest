import type { TreeNode } from "@nest/shared";

/** Flatten active pack roots + their folders/md files for @ mentions. */
export function collectMentionCandidates(
  tree: TreeNode[],
  activeRoots: string[],
): { path: string; kind: "file" | "folder"; name: string }[] {
  if (activeRoots.length === 0) return [];
  const roots = new Set(activeRoots);
  const out: { path: string; kind: "file" | "folder"; name: string }[] = [];

  const walk = (node: TreeNode) => {
    if (node.kind === "folder") {
      out.push({ path: node.path, kind: "folder", name: node.name });
      for (const child of node.children ?? []) {
        walk(child);
      }
    } else if (node.name.toLowerCase().endsWith(".md")) {
      out.push({ path: node.path, kind: "file", name: node.name });
    }
  };

  for (const root of tree) {
    if (root.kind === "folder" && roots.has(root.path)) {
      walk(root);
    }
  }
  return out;
}
