import {
  Files,
  GitBranch,
  PackageSearch,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  SETTINGS_TAB_ID,
  type ActivitySidebarView,
  useUiStore,
} from "@/stores/ui";

const ITEMS: {
  view: ActivitySidebarView;
  icon: typeof Files;
  label: string;
}[] = [
  { view: "explorer", icon: Files, label: "Explorer" },
  { view: "source-control", icon: GitBranch, label: "Source Control" },
  { view: "reviews", icon: PackageSearch, label: "Under Review" },
];

export function ActivityBar({
  hasSourceControlChanges,
  hasPacksUnderReview,
  hasPackUpdates,
}: {
  hasSourceControlChanges: boolean;
  hasPacksUnderReview: boolean;
  hasPackUpdates: boolean;
}) {
  const { t } = useI18n();
  const activeView = useUiStore((s) => s.activitySidebarView);
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const setActiveView = useUiStore((s) => s.setActivitySidebarView);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const openSettingsTab = useUiStore((s) => s.openSettingsTab);

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar/60 py-2">
      {ITEMS.map(({ view, icon: Icon, label }) => {
        const isOpenAndActive = sidebarOpen && activeView === view;
        const showDot =
          (view === "source-control" &&
            (hasSourceControlChanges || hasPackUpdates)) ||
          (view === "reviews" && hasPacksUnderReview);
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
      <div className="mt-auto flex flex-col gap-1">
        <ActivityButton
          label={t("shell.settings")}
          active={activeMainTabId === SETTINGS_TAB_ID}
          onClick={openSettingsTab}
          icon={<Settings className="size-4" />}
        />
      </div>
    </nav>
  );
}

function ActivityButton({
  label,
  active,
  onClick,
  icon,
  dot = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "text-muted-foreground",
            active && "bg-muted text-foreground",
          )}
        >
          <span className="relative inline-flex">
            {icon}
            {dot ? (
              <span className="absolute -right-0.5 -top-0.5 block size-1.5 rounded-full bg-amber-500 ring-1 ring-background" />
            ) : null}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
