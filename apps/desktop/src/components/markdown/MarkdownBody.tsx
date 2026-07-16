import { isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "@/components/markdown/MermaidDiagram";
import { VaultImage } from "@/components/markdown/VaultImage";
import { cn } from "@/lib/utils";

type MarkdownBodyProps = {
  children: string;
  className?: string;
  basePath?: string;
};

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

export function MarkdownBody({ children, className, basePath }: MarkdownBodyProps) {
  const components: Components = {
    img: ({ src, alt }) => <VaultImage src={src} alt={alt} baseDir={basePath ?? ""} />,
    pre: ({ children: preChildren, ...props }) => {
      const codeEl = isValidElement<{ className?: string; children?: ReactNode }>(
        preChildren,
      )
        ? preChildren
        : undefined;
      const lang = /language-(\w+)/.exec(codeEl?.props.className ?? "")?.[1];
      if (lang === "mermaid") {
        return <MermaidDiagram code={extractText(codeEl?.props.children)} />;
      }
      return <pre {...props}>{preChildren}</pre>;
    },
  };

  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
