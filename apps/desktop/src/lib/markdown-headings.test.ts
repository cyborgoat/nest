import { describe, expect, it } from "vitest";
import {
  activeHeadingFromPositions,
  extractMarkdownHeadings,
  tocHeadings,
} from "@/lib/markdown-headings";

describe("markdown headings", () => {
  it("extracts formatted Unicode headings and filters the TOC to H2-H4", () => {
    const headings = extractMarkdownHeadings(
      [
        "# Document title",
        "## Hello *formatted* `world`",
        "#### 中文 标题！",
        "##### Too deep",
      ].join("\n\n"),
    );

    expect(headings.map(({ id, level, text }) => ({ id, level, text }))).toEqual([
      { id: "document-title", level: 1, text: "Document title" },
      {
        id: "hello-formatted-world",
        level: 2,
        text: "Hello formatted world",
      },
      { id: "中文-标题", level: 4, text: "中文 标题！" },
      { id: "too-deep", level: 5, text: "Too deep" },
    ]);
    expect(tocHeadings(headings).map(({ level }) => level)).toEqual([2, 4]);
  });

  it("creates stable unique IDs for duplicates and empty slugs", () => {
    const headings = extractMarkdownHeadings(
      ["## Repeat", "## Repeat", "## repeat", "## 🎉", "## 🎉"].join(
        "\n\n",
      ),
    );

    expect(headings.map(({ id }) => id)).toEqual([
      "repeat",
      "repeat-1",
      "repeat-2",
      "section",
      "section-1",
    ]);
  });

  it("selects the current section at the start, between headings, and at the end", () => {
    const positions = [
      { id: "first", top: 80 },
      { id: "second", top: 240 },
      { id: "third", top: 400 },
    ];

    expect(activeHeadingFromPositions(positions, 20, false)).toBe("first");
    expect(activeHeadingFromPositions(positions, 250, false)).toBe("second");
    expect(activeHeadingFromPositions(positions, 20, true)).toBe("third");
    expect(activeHeadingFromPositions([], 20, false)).toBeNull();
  });
});
