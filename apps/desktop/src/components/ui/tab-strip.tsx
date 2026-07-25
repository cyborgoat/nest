import { X } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

type TabStripItem = {
  id: string;
  label: string;
  /** Hover tooltip; defaults to label. */
  title?: string;
  icon?: ReactNode;
  /** Preview tabs render italic. */
  italic?: boolean;
  /** Shows an unsaved-changes dot next to the label. */
  dirty?: boolean;
};

export function TabStrip({
  items,
  activeId,
  onSelect,
  onClose,
  onItemDoubleClick,
  emptyLabel,
  trailing,
  closeLabel,
}: {
  items: TabStripItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onItemDoubleClick?: (id: string) => void;
  emptyLabel: string;
  /** Right-aligned action cluster (e.g. new-chat / history buttons). */
  trailing?: ReactNode;
  closeLabel?: (item: TabStripItem) => string;
}) {
  const close = (e: MouseEvent | KeyboardEvent, id: string) => {
    e.stopPropagation();
    onClose(id);
  };

  return (
    <div className="flex h-10 overflow-hidden items-stretch gap-1 border-b border-border px-1.5">
      <div className="tab-scroll flex h-full min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto overflow-y-hidden">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              onDoubleClick={
                onItemDoubleClick ? () => onItemDoubleClick(item.id) : undefined
              }
              className={cn(
                "group relative flex h-full max-w-44 shrink-0 items-center gap-1.5 px-2.5 text-xs transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title={item.title ?? item.label}
            >
              {item.icon}
              <span className={cn("truncate", item.italic && "italic")}>
                {item.label}
              </span>
              {item.dirty && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                  aria-label="Unsaved changes"
                />
              )}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => close(e, item.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    close(e, item.id);
                  }
                }}
                className="rounded-sm p-0.5 opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={closeLabel?.(item) ?? `Close ${item.label}`}
              >
                <X className="size-3" />
              </span>
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
        {items.length === 0 && (
          <span className="flex items-center px-2 text-xs text-muted-foreground">
            {emptyLabel}
          </span>
        )}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-0.5">{trailing}</div>
      )}
    </div>
  );
}
