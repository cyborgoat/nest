import { FileText, Loader2, Sparkles } from "lucide-react";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";

export type AgentActivity =
  | { kind: "reading"; path: string }
  | { kind: "generating" }
  | null;

function labelFor(activity: NonNullable<AgentActivity>): string {
  if (activity.kind === "generating") return "Generating response…";
  if (activity.path === "vault_search") return "Searching the vault…";
  const name = activity.path.split("/").pop() || activity.path;
  return `Reading ${name}…`;
}

export function AgentStatusIndicator({ activity }: { activity: AgentActivity }) {
  if (!activity) return null;

  const Icon = activity.kind === "generating" ? Sparkles : FileText;

  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      <Icon className="size-3.5 shrink-0 text-accent" />
      <TextShimmer
        as="span"
        className="text-xs [--base-color:#556270] [--base-gradient-color:#0d6e6e]"
        duration={1.6}
        spread={1.5}
      >
        {labelFor(activity)}
      </TextShimmer>
    </div>
  );
}
