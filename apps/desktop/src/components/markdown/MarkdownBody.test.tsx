import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";

describe("MarkdownBody", () => {
  it("renders inline and display math with KaTeX", () => {
    const html = renderToStaticMarkup(
      <MarkdownBody>
        {"Inline $E = mc^2$\n\n$$\n\\int_0^1 x^2 dx\n$$"}
      </MarkdownBody>,
    );

    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
    expect(html).toContain("E = mc");
  });
});
