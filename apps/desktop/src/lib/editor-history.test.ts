import { describe, expect, it } from "vitest";
import {
  createEditorHistory,
  currentEditorHistory,
  recordEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from "@/lib/editor-history";

describe("editor history", () => {
  it("coalesces typing and supports undo and redo", () => {
    let history = createEditorHistory("");
    history = recordEditorHistory(history, "a", 100);
    history = recordEditorHistory(history, "ab", 200);
    expect(history.entries).toEqual(["", "ab"]);
    history = undoEditorHistory(history);
    expect(currentEditorHistory(history)).toBe("");
    history = redoEditorHistory(history);
    expect(currentEditorHistory(history)).toBe("ab");
  });

  it("clears redo states after editing an undone value", () => {
    let history = recordEditorHistory(createEditorHistory("a"), "b", 100);
    history = recordEditorHistory(history, "c", 1000);
    history = undoEditorHistory(history);
    history = recordEditorHistory(history, "d", 2000);
    expect(history.entries).toEqual(["a", "b", "d"]);
  });
});
