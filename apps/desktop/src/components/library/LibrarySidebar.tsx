import type { InstalledPack, TreeNode } from "@nest/shared";
import { ExplorerPanel } from "@/components/library/ExplorerPanel";
import { SourceControlPanel } from "@/components/library/SourceControlPanel";
import { UnderReviewPanel } from "@/components/library/UnderReviewPanel";
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
    <aside className="flex h-full min-h-0 min-w-0 flex-col border-r border-border">
      {view === "explorer" ? (
        <ExplorerPanel
          tree={tree}
          installed={installed}
          loading={loading}
          error={error}
        />
      ) : view === "source-control" ? (
        <SourceControlPanel installed={installed} />
      ) : (
        <UnderReviewPanel installed={installed} tree={tree} />
      )}
    </aside>
  );
}
