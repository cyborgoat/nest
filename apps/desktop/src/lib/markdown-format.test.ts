import { describe, expect, it } from "vitest";
import { formatMarkdown } from "./markdown-format";

describe("formatMarkdown", () => {
  it("normalizes bullet markers to the remark default", async () => {
    const result = await formatMarkdown("- one\n- two\n- three\n");
    expect(result).toBe("* one\n* two\n* three\n");
  });

  it("normalizes code fence markers to backticks", async () => {
    const result = await formatMarkdown("~~~js\nconsole.log(1)\n~~~\n");
    expect(result).toBe("```js\nconsole.log(1)\n```\n");
  });

  it("leaves an already-canonical document unchanged", async () => {
    const source = "# Title\n\n* one\n* two\n";
    expect(await formatMarkdown(source)).toBe(source);
  });

  it("preserves GFM tables and task lists", async () => {
    const source =
      "| A | B |\n| - | - |\n| 1 | 2 |\n\n- [ ] todo\n- [x] done\n";
    const result = await formatMarkdown(source);
    expect(result).toContain("| A");
    expect(result).toContain("[ ] todo");
    expect(result).toContain("[x] done");
  });
});
