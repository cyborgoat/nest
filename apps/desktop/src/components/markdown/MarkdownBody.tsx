import { isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "@/components/markdown/MermaidDiagram";
import { VaultImage } from "@/components/markdown/VaultImage";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

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

const EXTERNAL_HREF = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

function resolveVaultMarkdownPath(baseDir: string, href: string): string | null {
  if (EXTERNAL_HREF.test(href) || href.startsWith("#")) return null;

  // A fragment identifies a heading in the target document; opening the target
  // document is still useful even though the viewer does not track headings yet.
  const rawPath = href.split(/[?#]/, 1)[0];
  if (!rawPath.toLowerCase().endsWith(".md")) return null;

  let ref: string;
  try {
    ref = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const parts = ref.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const part of ref.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/") || null;
}

export function MarkdownBody({ children, className, basePath }: MarkdownBodyProps) {
  const openFileTab = useUiStore((state) => state.openFileTab);
  const components: Components = {
    a: ({ href, children: linkChildren, ...props }) => {
      const vaultPath = href
        ? resolveVaultMarkdownPath(basePath ?? "", href)
        : null;

      if (!vaultPath) {
        return (
          <a href={href} {...props}>
            {linkChildren}
          </a>
        );
      }

      return (
        <a
          href={href}
          {...props}
          onClick={(event) => {
            event.preventDefault();
            openFileTab(vaultPath);
          }}
        >
          {linkChildren}
        </a>
      );
    },
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
    table: ({ children: tableChildren, ...props }) => (
      <div className="overflow-x-auto">
        <table {...props}>{tableChildren}</table>
      </div>
    ),
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
