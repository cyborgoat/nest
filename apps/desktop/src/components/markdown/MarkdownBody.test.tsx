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

  it("assigns deterministic IDs to headings", () => {
    const html = renderToStaticMarkup(
      <MarkdownBody>
        {"# Title\n\n## Repeated heading\n\n## Repeated heading\n\n### 中文 标题"}
      </MarkdownBody>,
    );

    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<h2 id="repeated-heading">Repeated heading</h2>');
    expect(html).toContain(
      '<h2 id="repeated-heading-1">Repeated heading</h2>',
    );
    expect(html).toContain('<h3 id="中文-标题">中文 标题</h3>');
  });
});
