import React, { type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Card, CARD_CLASSES, Skeleton } from "./ui";

export function Metric({
  label,
  value = 0,
  icon,
  tone = "green",
  loading = false,
  onClick,
  active = false,
}: {
  label: string;
  value?: number;
  icon: ReactNode;
  tone?: "green" | "amber" | "stone";
  loading?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const content = (
    <>
      <div
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl",
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
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          CARD_CLASSES,
          "flex w-full items-center gap-4 text-left transition",
          active
            ? "border-primary/40 ring-2 ring-primary"
            : "hover:border-primary/30",
        )}
      >
        {content}
      </button>
    );
  }
  return <Card className="flex items-center gap-4">{content}</Card>;
}
