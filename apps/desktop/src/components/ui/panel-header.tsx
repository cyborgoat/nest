import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared framing for panel headers.
 * - "default": full header with display title, optional badges/description,
 *   right-aligned actions (Hub, Settings).
 * - "compact": fixed h-10 bar aligned with the tab-strip row height; free
 *   content goes in children (e.g. the viewer breadcrumb).
 */
export function PanelHeader({
  title,
  description,
  badges,
  actions,
  size = "default",
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  size?: "default" | "compact";
  className?: string;
  children?: ReactNode;
}) {
  if (size === "compact") {
    return (
      <div
        className={cn(
          "flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-4",
          className,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    );
  }

  return (
    <div className={cn("border-b border-border px-4 py-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {title && <h2 className="font-display text-xl">{title}</h2>}
            {badges}
          </div>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
