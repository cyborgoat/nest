import { FileText, Loader2 } from "lucide-react";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";

export type AgentActivity =
  | { kind: "reading"; path: string }
  | { kind: "generating" }
  | null;

function labelFor(activity: NonNullable<AgentActivity>): string {
  if (activity.kind === "generating") return "Generating response…";
  const name = activity.path.split("/").pop() || activity.path;
  return `Reading ${name}…`;
}

export function AgentStatusIndicator({ activity }: { activity: AgentActivity }) {
  if (!activity) return null;

  const isGenerating = activity.kind === "generating";

  return (
    <div className="mb-2 flex items-center gap-2">
      {!isGenerating && (
        <>
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
          <FileText className="size-3.5 shrink-0 text-accent" />
        </>
      )}
      <TextShimmer
        as="span"
        duration={1}
        spread={3}
        className={
          isGenerating
            ? "text-sm font-medium [--base-color:var(--shimmer-base)] [--base-gradient-color:var(--color-primary)]"
            : "text-xs font-medium [--base-color:var(--shimmer-base)] [--base-gradient-color:var(--color-primary)]"
        }
      >
        {labelFor(activity)}
      </TextShimmer>
    </div>
  );
}
