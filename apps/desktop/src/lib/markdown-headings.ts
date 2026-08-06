import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

export type MarkdownHeading = {
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  sourceOffset: number;
};

type MarkdownNode = {
  type?: string;
  value?: string;
  alt?: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: { start?: { offset?: number } };
};

function nodeText(node: MarkdownNode): string {
  if (node.type === "image") return node.alt ?? "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function slugBase(text: string): string {
  return (
    text
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

export function extractMarkdownHeadings(markdown: string): MarkdownHeading[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  const headings: MarkdownHeading[] = [];
  const usedIds = new Set<string>();
  const nextSuffix = new Map<string, number>();

  function uniqueSlug(text: string): string {
    const base = slugBase(text);
    let candidate = base;
    let suffix = nextSuffix.get(base) ?? 1;
    while (usedIds.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    nextSuffix.set(base, suffix);
    usedIds.add(candidate);
    return candidate;
  }

  function visit(node: MarkdownNode) {
    if (
      node.type === "heading" &&
      node.depth != null &&
      node.depth >= 1 &&
      node.depth <= 6 &&
      node.position?.start?.offset != null
    ) {
      const text = nodeText(node).replace(/\s+/g, " ").trim();
      headings.push({
        id: uniqueSlug(text),
        level: node.depth as MarkdownHeading["level"],
        text,
        sourceOffset: node.position.start.offset,
      });
    }
    node.children?.forEach(visit);
  }

  visit(tree);
  return headings;
}

export function tocHeadings(headings: MarkdownHeading[]): MarkdownHeading[] {
  return headings.filter(({ level }) => level >= 2 && level <= 4);
}

export function activeHeadingFromPositions(
  headings: { id: string; top: number }[],
  topBoundary: number,
  atDocumentEnd: boolean,
): string | null {
  if (headings.length === 0) return null;
  if (atDocumentEnd) return headings[headings.length - 1].id;

  let activeId = headings[0].id;
  for (const heading of headings) {
    if (heading.top > topBoundary) break;
    activeId = heading.id;
  }
  return activeId;
}
