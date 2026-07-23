import React, { type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Card } from "./ui";

export function Metric({
  label,
  value = 0,
  icon,
  tone = "green",
}: {
  label: string;
  value?: number;
  icon: ReactNode;
  tone?: "green" | "amber" | "stone";
}) {
  return (
    <Card className="flex items-center gap-4">
      <div
        className={cn(
          "grid size-11 place-items-center rounded-xl",
          tone === "amber"
            ? "bg-amber-100 text-amber-700"
            : tone === "stone"
              ? "bg-stone-200 text-stone-700"
              : "bg-emerald-100 text-emerald-700",
        )}
      >
        {React.cloneElement(
          icon as React.ReactElement<{ className?: string }>,
          { className: "size-5" },
        )}
      </div>
      <div>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-stone-500">{label}</p>
      </div>
    </Card>
  );
}
