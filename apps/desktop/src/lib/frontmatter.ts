import yaml from "js-yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export type FrontmatterData = Record<string, unknown>;

export function parseFrontmatter(raw: string): {
  data: FrontmatterData | null;
  content: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { data: null, content: raw };

  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: null, content: raw };
    }
    return { data: parsed as FrontmatterData, content: raw.slice(match[0].length) };
  } catch {
    return { data: null, content: raw };
  }
}
