import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Ad hoc positive/success tone — shared so callers outside Badge (e.g. the
 * Message Center's kind-coding) don't duplicate the same hex values. */
export const POSITIVE_TONE_CLASSES = "bg-[#e4f4e8] text-[#23663a]";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
  {
    variants: {
      variant: {
        accent: "bg-accent/15 text-accent-text",
        destructive: "bg-destructive/10 text-destructive",
        muted: "bg-muted text-muted-foreground",
        outline: "border border-border text-muted-foreground",
        update: POSITIVE_TONE_CLASSES,
      },
    },
    defaultVariants: {
      variant: "muted",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}
