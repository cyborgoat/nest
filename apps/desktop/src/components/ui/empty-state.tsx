import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * - "plain": centered full-height hero (main area empty states).
 * - "dashed": inline dashed card (hub offline / empty lists).
 */
export function EmptyState({
  icon,
  title,
  description,
  children,
  footnote,
  variant = "plain",
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  /** CTA row or free content below the description. */
  children?: ReactNode;
  footnote?: ReactNode;
  variant?: "plain" | "dashed";
  className?: string;
}) {
  if (variant === "dashed") {
    return (
      <section
        className={cn(
          "space-y-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center",
          className,
        )}
      >
        <div className="mx-auto w-fit text-muted-foreground">{icon}</div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        )}
        {children}
        {footnote && (
          <p className="text-xs text-muted-foreground">{footnote}</p>
        )}
      </section>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center gap-4 p-8 text-center",
        className,
      )}
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-full bg-muted p-4"
      >
        {icon}
      </motion.div>
      <div>
        <h2 className="font-display text-xl">{title}</h2>
        {description && (
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children}
      {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
    </div>
  );
}
