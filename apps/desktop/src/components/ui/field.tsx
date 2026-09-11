import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + control stack used by every small metadata form (pack dialogs,
 * import, settings). Spacing widens slightly to fit `description` when
 * present, matching the original settings-only layout exactly. */
export function Field({
  label,
  description,
  action,
  children,
}: {
  label: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  if (action) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <Label>{label}</Label>
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center">{action}</div>
        </div>
        <div className="mt-1.5">{children}</div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", description && "space-y-1.5")}>
      <Label>{label}</Label>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
