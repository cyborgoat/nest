import { describe, expect, it } from "vitest";
import { detectMarkdownStyle } from "./markdown-style";

describe("detectMarkdownStyle", () => {
  it("falls back to remark defaults for a plain document", () => {
    expect(detectMarkdownStyle("# Title\n\nJust a paragraph.\n")).toEqual({
      bullet: "*",
      fence: "`",
      rule: "*",
      strong: "*",
      emphasis: "*",
    });
  });

  it("detects a file that consistently uses asterisk bullets", () => {
    const style = detectMarkdownStyle("* one\n* two\n* three\n");
    expect(style.bullet).toBe("*");
  });

  it("detects a file that consistently uses plus bullets", () => {
    const style = detectMarkdownStyle("+ one\n+ two\n");
    expect(style.bullet).toBe("+");
  });

  it("picks the majority bullet when a file mixes markers", () => {
    const style = detectMarkdownStyle("- a\n- b\n- c\n* d\n");
    expect(style.bullet).toBe("-");
  });

  it("detects tilde code fences", () => {
    const style = detectMarkdownStyle("~~~js\nconsole.log(1)\n~~~\n");
    expect(style.fence).toBe("~");
  });

  it("ignores bullet-like lines inside a fenced code block", () => {
    const style = detectMarkdownStyle("```\n* not a list\n```\n- real list\n");
    expect(style.bullet).toBe("-");
  });

  it("detects underscore emphasis and strong markers", () => {
    const style = detectMarkdownStyle("_italic_ and __bold__ text\n");
    expect(style.emphasis).toBe("_");
    expect(style.strong).toBe("_");
  });

  it("detects a non-default thematic break marker", () => {
    const style = detectMarkdownStyle("above\n\n___\n\nbelow\n");
    expect(style.rule).toBe("_");
  });

  it("does not mistake a YAML frontmatter delimiter for a thematic break", () => {
    const style = detectMarkdownStyle(
      "---\ntitle: Doc\n---\n\nabove\n\n___\n\nbelow\n",
    );
    expect(style.rule).toBe("_");
  });
});
