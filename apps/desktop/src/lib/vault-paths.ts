const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
]);

export function fileName(path: string): string {
  return path.split("/").pop() || path;
}

export function fileExtension(path: string): string {
  const base = fileName(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isMarkdownPath(path: string): boolean {
  return fileExtension(path) === "md";
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(path));
}

export function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function fileStem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Build a relative vault path from `fromDir` to `toPath` (both vault-relative). */
export function relativeVaultPath(fromDir: string, toPath: string): string {
  const fromParts = fromDir ? fromDir.split("/").filter(Boolean) : [];
  const toParts = toPath.split("/").filter(Boolean);
  let i = 0;
  while (
    i < fromParts.length &&
    i < toParts.length &&
    fromParts[i] === toParts[i]
  ) {
    i += 1;
  }
  const ups = fromParts.length - i;
  const downs = toParts.slice(i);
  const parts = [...Array(ups).fill(".."), ...downs];
  const rel = parts.join("/") || ".";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Markdown to insert for a vault file relative to the open document's directory. */
export function markdownForVaultDrop(
  openFilePath: string,
  droppedPath: string,
): string {
  const fromDir = parentDir(openFilePath);
  const rel = relativeVaultPath(fromDir, droppedPath);
  const name = fileStem(fileName(droppedPath));
  if (isImagePath(droppedPath)) {
    return `![${name}](${rel})`;
  }
  return `[${name}](${rel})`;
}

export function ensureMdExtension(name: string): string {
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

/** Keep a supported image extension when renaming; do not force `.md`. */
export function ensureImageExtension(name: string, currentName: string): string {
  if (isImagePath(name)) return name;
  const currentExt = fileExtension(currentName);
  if (currentExt && IMAGE_EXTENSIONS.has(currentExt)) {
    return `${name}.${currentExt}`;
  }
  return name;
}
