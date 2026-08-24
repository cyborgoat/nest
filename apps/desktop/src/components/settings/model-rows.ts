export function parseModelRows(value: string | null | undefined): string[] {
  const rows = (value ?? "").split("\n").map((row) => row);
  return rows.length === 0 ? [""] : rows;
}

export function serializeModelRows(rows: string[]): string {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized.join("\n");
}

export function isDuplicateRow(rows: string[], index: number): boolean {
  const trimmed = rows[index]?.trim() ?? "";
  if (!trimmed) return false;
  return rows.some((row, i) => i !== index && row.trim() === trimmed);
}
