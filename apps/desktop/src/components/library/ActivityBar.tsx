import { Files, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ActivitySidebarView, useUiStore } from "@/stores/ui";

const ITEMS: {
  view: ActivitySidebarView;
  icon: typeof Files;
  label: string;
}[] = [
  { view: "explorer", icon: Files, label: "Explorer" },
  { view: "source-control", icon: GitBranch, label: "Source Control" },
];

export function ActivityBar({
  hasSourceControlChanges,
}: {
  hasSourceControlChanges: boolean;
}) {
  const activeView = useUiStore((s) => s.activitySidebarView);
  const setActiveView = useUiStore((s) => s.setActivitySidebarView);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar/60 py-2">
      {ITEMS.map(({ view, icon: Icon, label }) => {
        const isOpenAndActive = sidebarOpen && activeView === view;
        const showDot = view === "source-control" && hasSourceControlChanges;
        return (
          <Tooltip key={view}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={label}
                aria-pressed={isOpenAndActive}
                onClick={() => {
                  if (isOpenAndActive) {
                    setSidebarOpen(false);
                    return;
                  }
                  setActiveView(view);
                  if (!sidebarOpen) setSidebarOpen(true);
                }}
                className={cn(
                  "text-muted-foreground",
                  isOpenAndActive && "bg-muted text-foreground",
                )}
              >
                <span className="relative inline-flex">
                  <Icon className="size-4" />
                  {showDot ? (
                    <span className="absolute -right-0.5 -top-0.5 block size-1.5 rounded-full bg-amber-500 ring-1 ring-background" />
                  ) : null}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
