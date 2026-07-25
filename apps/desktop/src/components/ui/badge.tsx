import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const POSITIVE_TONE_CLASSES = "bg-success-muted text-success";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
  {
    variants: {
      variant: {
        accent: "bg-accent/15 text-accent-text",
        destructive: "bg-destructive/10 text-destructive",
        muted: "bg-muted text-muted-foreground",
        outline: "border border-border text-muted-foreground",
        update: POSITIVE_TONE_CLASSES,
        modified: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        new: POSITIVE_TONE_CLASSES,
      },
    },
    defaultVariants: {
      variant: "muted",
    },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}
