import React, { type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Card, Skeleton } from "./ui";

export function Metric({
  label,
  value = 0,
  icon,
  tone = "green",
  loading = false,
}: {
  label: string;
  value?: number;
  icon: ReactNode;
  tone?: "green" | "amber" | "stone";
  loading?: boolean;
}) {
  return (
    <Card className="flex items-center gap-4">
      <div
        className={cn(
          "grid size-11 place-items-center rounded-xl",
          tone === "amber"
            ? "bg-amber-100 text-amber-800"
            : tone === "stone"
              ? "bg-muted text-muted-foreground"
              : "bg-primary/10 text-primary",
        )}
      >
        {React.cloneElement(
          icon as React.ReactElement<{ className?: string }>,
          { className: "size-5" },
        )}
      </div>
      <div>
        {loading ? (
          <Skeleton className="h-8 w-10" />
        ) : (
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
        )}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}
