import { parseFrontmatter } from "@/lib/frontmatter";

/** The subset of remark-stringify's options that noticeably change how a
 * round-tripped document looks. Milkdown's ProseMirror schema doesn't carry
 * a memory of "this bullet was a `*`" the way it does for emphasis/strong
 * markers, so without matching these to the file's own convention, editing
 * even a single character reformats every list/fence/rule in the document
 * to remark's library defaults on save. */
export type MarkdownStyle = {
  bullet: "-" | "*" | "+";
  emphasis: "_" | "*";
  strong: "_" | "*";
  fence: "`" | "~";
  rule: "-" | "*" | "_";
};

const BULLET_RE = /^\s*([-*+])\s+\S/;
const FENCE_RE = /^(`{3,}|~{3,})/;
const RULE_RE = /^\s*([-*_])(?:\s?\1){2,}\s*$/;
const STRONG_RE = /\*\*[^*\n]+\*\*|__[^_\n]+__/g;
const EMPHASIS_RE = /(?<!\*)\*(?!\*)[^*\n]+\*(?!\*)|(?<!_)_(?!_)[^_\n]+_(?!_)/g;

function mostCommon<T extends string>(
  counts: Partial<Record<T, number>>,
  fallback: T,
): T {
  let best = fallback;
  let bestCount = 0;
  for (const [key, count] of Object.entries(counts) as [T, number][]) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function tally<T extends string>(counts: Partial<Record<T, number>>, key: T) {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Sniff the dominant list-bullet, fence, thematic-break, and emphasis/
 * strong marker conventions already used in a markdown document, so the
 * editor's serializer can be configured to match rather than silently
 * normalizing everything to remark's defaults on the next save. */
export function detectMarkdownStyle(source: string): MarkdownStyle {
  // Frontmatter delimiters (`---`) would otherwise be misread as thematic
  // breaks and skew the rule-marker tally.
  const { content } = parseFrontmatter(source);

  const bulletCounts: Partial<Record<MarkdownStyle["bullet"], number>> = {};
  const fenceCounts: Partial<Record<MarkdownStyle["fence"], number>> = {};
  const ruleCounts: Partial<Record<MarkdownStyle["rule"], number>> = {};
  const strongCounts: Partial<Record<MarkdownStyle["strong"], number>> = {};
  const emphasisCounts: Partial<Record<MarkdownStyle["emphasis"], number>> = {};

  let inFence = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trimStart();

    const fenceMatch = FENCE_RE.exec(trimmed);
    if (fenceMatch) {
      if (!inFence) tally(fenceCounts, fenceMatch[1][0] as "`" | "~");
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const bulletMatch = BULLET_RE.exec(line);
    if (bulletMatch) {
      tally(bulletCounts, bulletMatch[1] as MarkdownStyle["bullet"]);
      continue;
    }

    const ruleMatch = RULE_RE.exec(line);
    if (ruleMatch) {
      tally(ruleCounts, ruleMatch[1] as MarkdownStyle["rule"]);
      continue;
    }

    for (const match of trimmed.matchAll(STRONG_RE)) {
      tally(strongCounts, match[0].startsWith("**") ? "*" : "_");
    }
    for (const match of trimmed.matchAll(EMPHASIS_RE)) {
      tally(emphasisCounts, match[0].startsWith("*") ? "*" : "_");
    }
  }

  return {
    bullet: mostCommon(bulletCounts, "*"),
    fence: mostCommon(fenceCounts, "`"),
    rule: mostCommon(ruleCounts, "*"),
    strong: mostCommon(strongCounts, "*"),
    emphasis: mostCommon(emphasisCounts, "*"),
  };
}
