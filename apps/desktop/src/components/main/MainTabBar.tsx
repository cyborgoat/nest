import { Cloud, FileText, Settings2, X } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { HUB_TAB_ID, SETTINGS_TAB_ID, useUiStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

function tabLabel(id: string) {
  if (id === HUB_TAB_ID) return "Hub";
  if (id === SETTINGS_TAB_ID) return "Settings";
  return id.split("/").pop() || id;
}

function TabIcon({ id }: { id: string }) {
  if (id === HUB_TAB_ID) return <Cloud className="size-3 shrink-0 text-accent" />;
  if (id === SETTINGS_TAB_ID)
    return <Settings2 className="size-3 shrink-0 text-accent" />;
  return <FileText className="size-3 shrink-0 text-primary" />;
}

export function MainTabBar() {
  const openMainTabs = useUiStore((s) => s.openMainTabs);
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const previewMainTabId = useUiStore((s) => s.previewMainTabId);
  const setActiveMainTab = useUiStore((s) => s.setActiveMainTab);
  const closeMainTab = useUiStore((s) => s.closeMainTab);
  const openFileTab = useUiStore((s) => s.openFileTab);

  const close = (e: MouseEvent | KeyboardEvent, id: string) => {
    e.stopPropagation();
    closeMainTab(id);
  };

  return (
    <div className="flex h-10 items-stretch gap-1 border-b border-border px-1.5">
      <div className="tab-scroll flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
        {openMainTabs.map((id) => {
          const active = id === activeMainTabId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveMainTab(id)}
              onDoubleClick={() => {
                if (id === previewMainTabId) openFileTab(id, { preview: false });
              }}
              className={cn(
                "group relative flex max-w-48 shrink-0 items-center gap-1.5 px-2.5 text-xs transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title={id}
            >
              <TabIcon id={id} />
              <span className={cn("truncate", id === previewMainTabId && "italic")}>
                {tabLabel(id)}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => close(e, id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    close(e, id);
                  }
                }}
                className="rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
                aria-label={`Close ${tabLabel(id)}`}
              >
                <X className="size-3" />
              </span>
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
              )}
            </button>
          );
        })}
        {openMainTabs.length === 0 && (
          <span className="flex items-center px-2 text-xs text-muted-foreground">
            No files open
          </span>
        )}
      </div>
    </div>
  );
}
