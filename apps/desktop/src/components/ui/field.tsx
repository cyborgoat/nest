import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Label + control stack used by every small metadata form (pack dialogs,
 * import, settings). Spacing widens slightly to fit `description` when
 * present, matching the original settings-only layout exactly. */
export function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
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
