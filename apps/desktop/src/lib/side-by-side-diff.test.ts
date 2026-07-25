import { describe, expect, it } from "vitest";
import { buildSideBySideRows } from "./side-by-side-diff";

describe("buildSideBySideRows", () => {
  it("marks identical content as unchanged", () => {
    const rows = buildSideBySideRows("a\nb\n", "a\nb\n");
    expect(rows).toEqual([
      { old: "a", new: "a", type: "unchanged" },
      { old: "b", new: "b", type: "unchanged" },
    ]);
  });

  it("pairs a changed line as modified", () => {
    const rows = buildSideBySideRows("a\nb\nc\n", "a\nB\nc\n");
    expect(rows).toEqual([
      { old: "a", new: "a", type: "unchanged" },
      { old: "b", new: "B", type: "modified" },
      { old: "c", new: "c", type: "unchanged" },
    ]);
  });

  it("reports a pure addition on the new side only", () => {
    const rows = buildSideBySideRows("a\n", "a\nb\n");
    expect(rows).toEqual([
      { old: "a", new: "a", type: "unchanged" },
      { old: null, new: "b", type: "added" },
    ]);
  });

  it("reports a pure removal on the old side only", () => {
    const rows = buildSideBySideRows("a\nb\n", "a\n");
    expect(rows).toEqual([
      { old: "a", new: "a", type: "unchanged" },
      { old: "b", new: null, type: "removed" },
    ]);
  });

  it("treats an entirely new file as all-added", () => {
    const rows = buildSideBySideRows("", "hello\nworld\n");
    expect(rows.every((r) => r.type === "added" && r.old === null)).toBe(true);
    expect(rows.map((r) => r.new)).toEqual(["hello", "world"]);
  });
});
