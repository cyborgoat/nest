import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Canonical uppercase section label (11px). */
export function SectionLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h3
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </h3>
  );
}
