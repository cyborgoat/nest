import { parentDir } from "@/lib/vault-paths";

/** Find the nearest explorer folder path under a screen point (Tauri drop). */
export function vaultFolderPathAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const folder = el.closest("[data-vault-kind='folder'][data-vault-path]");
  if (folder instanceof HTMLElement) {
    return folder.dataset.vaultPath ?? null;
  }
  // Dropping on a file row: use its parent folder.
  const file = el.closest("[data-vault-kind='file'][data-vault-path]");
  if (file instanceof HTMLElement) {
    const path = file.dataset.vaultPath ?? "";
    // A root-level file (no "/") has no parent folder to drop into — keep
    // that `null`, distinct from parentDir's `""` ("root is the parent").
    return path.includes("/") ? parentDir(path) : null;
  }
  // Anywhere else inside the explorer tree: no specific folder.
  if (el.closest("[data-explorer-tree]")) {
    return null;
  }
  return null;
}

export function isPointOverExplorer(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  return !!el?.closest("[data-explorer-tree], [data-explorer-panel]");
}

export function isPointOverEditor(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  return !!el?.closest("[data-markdown-editor]");
}
