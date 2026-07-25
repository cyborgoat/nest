import { diffLines } from "diff";

export type DiffRow = {
  old: string | null;
  new: string | null;
  type: "unchanged" | "added" | "removed" | "modified";
};

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Builds GitHub-style split-diff rows from two full-file strings. A removed
 * chunk immediately followed by an added chunk (the common "line changed"
 * case) is paired row-by-row as "modified"; otherwise removed/added chunks
 * stand alone on their respective side.
 */
export function buildSideBySideRows(oldStr: string, newStr: string): DiffRow[] {
  const changes = diffLines(oldStr, newStr);
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < changes.length) {
    const change = changes[i];
    if (!change.added && !change.removed) {
      for (const line of splitLines(change.value)) {
        rows.push({ old: line, new: line, type: "unchanged" });
      }
      i++;
      continue;
    }
    if (change.removed) {
      const removedLines = splitLines(change.value);
      const next = changes[i + 1];
      if (next?.added) {
        const addedLines = splitLines(next.value);
        const max = Math.max(removedLines.length, addedLines.length);
        for (let j = 0; j < max; j++) {
          rows.push({
            old: removedLines[j] ?? null,
            new: addedLines[j] ?? null,
            type: "modified",
          });
        }
        i += 2;
        continue;
      }
      for (const line of removedLines) {
        rows.push({ old: line, new: null, type: "removed" });
      }
      i++;
      continue;
    }
    for (const line of splitLines(change.value)) {
      rows.push({ old: null, new: line, type: "added" });
    }
    i++;
  }
  return rows;
}
