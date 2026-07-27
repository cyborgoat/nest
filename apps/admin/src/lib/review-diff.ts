import type { PublishReviewDiffLine } from "@nest/shared";

type DisplayedDiffLine =
  | { kind: "line"; line: PublishReviewDiffLine }
  | { kind: "gap"; count: number };

const lineEntry = (line: PublishReviewDiffLine): DisplayedDiffLine => ({
  kind: "line",
  line,
});

export function collapseDiffContext(
  lines: PublishReviewDiffLine[],
  context = 3,
): DisplayedDiffLine[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.type !== "context") {
      for (
        let nearby = Math.max(0, index - context);
        nearby <= Math.min(lines.length - 1, index + context);
        nearby++
      ) {
        keep.add(nearby);
      }
    }
  });
  if (keep.size === 0) return lines.slice(0, 12).map(lineEntry);
  const output: DisplayedDiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    if (keep.has(index)) {
      output.push(lineEntry(lines[index]));
      index++;
      continue;
    }
    const start = index;
    while (index < lines.length && !keep.has(index)) index++;
    output.push({ kind: "gap", count: index - start });
  }
  return output;
}

export function expandedDiff(lines: PublishReviewDiffLine[]) {
  return lines.map(lineEntry);
}
