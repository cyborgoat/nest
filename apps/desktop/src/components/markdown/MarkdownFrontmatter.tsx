import type { FrontmatterData } from "@/lib/frontmatter";
import { Badge } from "@/components/ui/badge";
import { VaultImage } from "@/components/markdown/VaultImage";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function formatDate(value: unknown): string | undefined {
  const raw = value instanceof Date ? value : new Date(asString(value) ?? "");
  if (Number.isNaN(raw.getTime())) return asString(value);
  return raw.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function MarkdownFrontmatter({
  data,
  basePath,
}: {
  data: FrontmatterData;
  basePath: string;
}) {
  const title = asString(data.title);
  const author = asString(data.author);
  const date = formatDate(data.date);
  const excerpt = asString(data.excerpt);
  const tags = asStringArray(data.tags);
  const thumbnail = asString(data.thumbnail);

  if (!title && !author && !date && !excerpt && tags.length === 0 && !thumbnail) {
    return null;
  }

  return (
    <div className="mb-6 border-b border-border pb-5">
      {thumbnail && (
        <div className="mb-4 overflow-hidden rounded-lg">
          <VaultImage src={thumbnail} alt={title ?? ""} baseDir={basePath} />
        </div>
      )}
      {title && (
        <h1 className="font-display text-2xl font-semibold leading-tight text-foreground">
          {title}
        </h1>
      )}
      {(author || date) && (
        <p className="mt-2 text-sm text-muted-foreground">
          {author}
          {author && date && " · "}
          {date}
        </p>
      )}
      {excerpt && <p className="mt-3 text-sm italic text-muted-foreground">{excerpt}</p>}
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="muted">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
