import type { InstalledPack, TreeNode } from "@nest/shared";
import { ActivityBar } from "@/components/library/ActivityBar";
import { ExplorerPanel } from "@/components/library/ExplorerPanel";
import { SourceControlPanel } from "@/components/library/SourceControlPanel";
import { useUiStore } from "@/stores/ui";

export function LibrarySidebar({
  tree,
  installed,
  loading,
  error,
}: {
  tree: TreeNode[];
  installed: InstalledPack[];
  loading: boolean;
  error: Error | null;
}) {
  const view = useUiStore((s) => s.activitySidebarView);

  return (
    <div className="flex h-full min-h-0">
      <ActivityBar />
      <aside className="flex h-full min-h-0 min-w-0 flex-1 flex-col border-r border-border">
        {view === "explorer" ? (
          <ExplorerPanel
            tree={tree}
            installed={installed}
            loading={loading}
            error={error}
          />
        ) : (
          <SourceControlPanel installed={installed} />
        )}
      </aside>
    </div>
  );
}
