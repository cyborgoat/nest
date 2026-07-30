export type EditorHistory = {
  entries: string[];
  index: number;
  lastRecordedAt: number | null;
};

const LIMIT = 100;
const COALESCE_MS = 500;

export function createEditorHistory(value: string): EditorHistory {
  return { entries: [value], index: 0, lastRecordedAt: null };
}

export function recordEditorHistory(
  history: EditorHistory,
  value: string,
  now = Date.now(),
): EditorHistory {
  if (history.entries[history.index] === value) return history;
  const entries = history.entries.slice(0, history.index + 1);
  const canCoalesce =
    entries.length > 1 &&
    history.index === history.entries.length - 1 &&
    history.lastRecordedAt != null &&
    now - history.lastRecordedAt <= COALESCE_MS;
  if (canCoalesce) entries[entries.length - 1] = value;
  else entries.push(value);
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
  return {
    entries,
    index: entries.length - 1,
    lastRecordedAt: now,
  };
}

export function undoEditorHistory(history: EditorHistory): EditorHistory {
  if (history.index === 0) return history;
  return { ...history, index: history.index - 1, lastRecordedAt: null };
}

export function redoEditorHistory(history: EditorHistory): EditorHistory {
  if (history.index >= history.entries.length - 1) return history;
  return { ...history, index: history.index + 1, lastRecordedAt: null };
}

export function currentEditorHistory(history: EditorHistory) {
  return history.entries[history.index] ?? "";
}
