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
  icon,
  badges,
  actions,
  navigation,
  size = "default",
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  navigation?: ReactNode;
  size?: "default" | "compact";
  className?: string;
  children?: ReactNode;
}) {
  if (size === "compact") {
    return (
      <div
        className={cn(
          "flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4",
          className,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    );
  }

  return (
    <div className={cn("border-b border-border/50", className)}>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {title && <h2 className="font-display text-xl">{title}</h2>}
              {badges}
            </div>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="px-4">{children}</div>}
      {navigation && <div className="-mb-px px-4">{navigation}</div>}
    </div>
  );
}
