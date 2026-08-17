import { FileDiff } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AgentProposalBanner({
  className,
  onClick,
  children,
}: {
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const content = children ?? (
    <>
      <span className="font-medium">Previewing an Agent proposal.</span>
      <span className="text-muted-foreground">
        Open the editor to review, approve, or reject the diff.
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex items-center gap-2 bg-info/10 px-4 py-2 text-left text-xs text-info hover:bg-info/15",
          className,
        )}
      >
        <FileDiff className="size-4 shrink-0" />
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 bg-info/10 px-4 py-2 text-xs text-info",
        className,
      )}
    >
      <FileDiff className="size-4 shrink-0" />
      {content}
    </div>
  );
}
