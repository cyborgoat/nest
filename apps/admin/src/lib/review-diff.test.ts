import { describe, expect, it } from "vitest";
import type { PublishReviewDiffLine } from "@nest/shared";
import { collapseDiffContext, expandedDiff } from "./review-diff";

const contextLine = (line: number): PublishReviewDiffLine => ({
  type: "context",
  old_line: line,
  new_line: line,
  content: `line ${line}`,
});

describe("review diff context", () => {
  it("keeps nearby context and collapses distant unchanged lines", () => {
    const lines = Array.from({ length: 20 }, (_, index) =>
      contextLine(index + 1),
    );
    lines[10] = {
      type: "added",
      old_line: null,
      new_line: 11,
      content: "new line",
    };
    const displayed = collapseDiffContext(lines, 2);
    expect(displayed).toEqual(
      expect.arrayContaining([
        { kind: "gap", count: 8 },
        { kind: "gap", count: 7 },
      ]),
    );
    expect(displayed.filter((entry) => entry.kind === "line")).toHaveLength(5);
  });

  it("returns every line when expanded", () => {
    const lines = [contextLine(1), contextLine(2)];
    expect(expandedDiff(lines)).toHaveLength(2);
  });
});
