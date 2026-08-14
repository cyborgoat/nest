import {
  Children,
  Fragment,
  createElement,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
  useMemo,
} from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { MermaidDiagram } from "@/components/markdown/MermaidDiagram";
import { VaultImage } from "@/components/markdown/VaultImage";
import {
  extractMarkdownHeadings,
  type MarkdownHeading,
} from "@/lib/markdown-headings";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

type MarkdownBodyProps = {
  children: string;
  className?: string;
  basePath?: string;
  headings?: MarkdownHeading[];
};

const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
type AlertType = (typeof ALERT_TYPES)[number];

const ALERT_LABELS: Record<AlertType, string> = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function stripAlertMarkerFromNode(node: ReactNode): ReactNode {
  if (typeof node === "string") {
    return node.replace(ALERT_MARKER, "");
  }
  if (Array.isArray(node)) {
    let stripped = false;
    return node.map((child) => {
      if (stripped) return child;
      if (typeof child === "string" && ALERT_MARKER.test(child)) {
        stripped = true;
        return child.replace(ALERT_MARKER, "");
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        const next = stripAlertMarkerFromNode(child.props.children);
        if (next !== child.props.children) {
          stripped = true;
          return createElement(child.type, { ...child.props, children: next });
        }
      }
      return child;
    });
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const next = stripAlertMarkerFromNode(node.props.children);
    if (next === node.props.children) return node;
    return createElement(node.type, { ...node.props, children: next });
  }
  return node;
}

function parseGithubAlert(children: ReactNode): {
  type: AlertType;
  body: ReactNode;
} | null {
  const nodes = Children.toArray(children);
  if (nodes.length === 0) return null;

  const contentIndex = nodes.findIndex(
    (node) => !(typeof node === "string" && node.trim() === ""),
  );
  if (contentIndex < 0) return null;

  const first = nodes[contentIndex];
  const firstText = extractText(first).trimStart();
  const match = ALERT_MARKER.exec(firstText);
  if (!match) return null;

  const type = match[1].toUpperCase() as AlertType;
  const remainder = stripAlertMarkerFromNode(first);
  const remainderText = extractText(remainder).trim();
  const rest = nodes.slice(contentIndex + 1).filter(
    (node) => !(typeof node === "string" && node.trim() === ""),
  );
  const bodyNodes =
    remainderText.length > 0 ? [remainder, ...rest] : rest;

  return {
    type,
    body:
      bodyNodes.length === 0
        ? null
        : bodyNodes.length === 1
          ? bodyNodes[0]
          : createElement(Fragment, null, ...bodyNodes),
  };
}

function GithubAlert({
  type,
  children,
}: {
  type: AlertType;
  children: ReactNode;
}) {
  return (
    <blockquote
      className={cn("markdown-alert", `markdown-alert-${type.toLowerCase()}`)}
    >
      <p className="markdown-alert-title">{ALERT_LABELS[type]}</p>
      {children}
    </blockquote>
  );
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

export function MarkdownBody({
  children,
  className,
  basePath,
  headings,
}: MarkdownBodyProps) {
  const openFileTab = useUiStore((state) => state.openFileTab);
  const parsedHeadings = useMemo(
    () => headings ?? extractMarkdownHeadings(children),
    [children, headings],
  );
  const headingIdByOffset = new Map(
    parsedHeadings.map((heading) => [heading.sourceOffset, heading.id]),
  );
  const renderHeading = (level: MarkdownHeading["level"]) =>
    ({
      node,
      children: headingChildren,
      ...props
    }: ComponentPropsWithoutRef<"h1"> & ExtraProps) => {
      const sourceOffset = node?.position?.start.offset;
      return createElement(
        `h${level}`,
        {
          ...props,
          id:
            sourceOffset == null
              ? undefined
              : headingIdByOffset.get(sourceOffset),
        },
        headingChildren,
      );
    };
  const components: Components = {
    h1: renderHeading(1),
    h2: renderHeading(2),
    h3: renderHeading(3),
    h4: renderHeading(4),
    h5: renderHeading(5),
    h6: renderHeading(6),
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
    img: ({ src, alt }) => (
      <VaultImage src={src} alt={alt} baseDir={basePath ?? ""} />
    ),
    blockquote: ({ children: quoteChildren, ...props }) => {
      const alert = parseGithubAlert(quoteChildren);
      if (alert) {
        return <GithubAlert type={alert.type}>{alert.body}</GithubAlert>;
      }
      return <blockquote {...props}>{quoteChildren}</blockquote>;
    },
    pre: ({ children: preChildren, ...props }) => {
      const codeEl = isValidElement<{ className?: string; children?: ReactNode }>(
        preChildren,
      )
        ? (preChildren as ReactElement<{
            className?: string;
            children?: ReactNode;
          }>)
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
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeKatex,
          [rehypeHighlight, { ignoreMissing: true }],
        ]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
