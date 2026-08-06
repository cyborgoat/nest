import { TableOfContents } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MarkdownHeading } from "@/lib/markdown-headings";
import { cn } from "@/lib/utils";

type TableOfContentsProps = {
  headings: MarkdownHeading[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

function entryClass(active: boolean) {
  return cn(
    "block w-full truncate rounded-sm py-1 text-left text-xs transition-colors",
    active
      ? "font-medium text-primary"
      : "text-muted-foreground hover:text-foreground",
  );
}

export function MarkdownTableOfContents({
  headings,
  activeId,
  onSelect,
}: TableOfContentsProps) {
  return (
    <nav aria-label="On this page">
      <p className="mb-2 text-xs font-semibold text-foreground">On this page</p>
      <ul className="space-y-0.5 border-l border-border">
        {headings.map((heading) => (
          <li key={heading.id}>
            <button
              type="button"
              className={entryClass(heading.id === activeId)}
              style={{ paddingLeft: `${8 + (heading.level - 2) * 12}px` }}
              aria-current={heading.id === activeId ? "location" : undefined}
              title={heading.text}
              onClick={() => onSelect(heading.id)}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function MarkdownTableOfContentsMenu({
  headings,
  activeId,
  onSelect,
  className,
}: TableOfContentsProps & { className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className={className}
          aria-label="Open table of contents"
        >
          <TableOfContents className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-[70vh] w-72 overflow-y-auto"
      >
        <DropdownMenuLabel>On this page</DropdownMenuLabel>
        {headings.map((heading) => (
          <DropdownMenuItem
            key={heading.id}
            className={cn(
              "cursor-pointer",
              heading.id === activeId && "bg-muted font-medium text-primary",
            )}
            style={{ paddingLeft: `${8 + (heading.level - 2) * 12}px` }}
            aria-current={heading.id === activeId ? "location" : undefined}
            onSelect={() => onSelect(heading.id)}
          >
            <span className="truncate">{heading.text}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
