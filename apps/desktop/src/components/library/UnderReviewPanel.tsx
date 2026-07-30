import type { InstalledPack, TreeNode } from "@nest/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Clock3, FileSearch, MessageSquare, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SidebarPaneHeader } from "@/components/ui/sidebar-pane-header";
import { api } from "@/lib/api";
import { pendingPublishVersionLabel } from "@/lib/publish-request-labels";
import { queryKeys } from "@/lib/query-keys";
import { useUiStore } from "@/stores/ui";

function firstFileUnder(nodes: TreeNode[], prefix: string): string | null {
  for (const node of nodes) {
    if (node.kind === "file" && node.path.startsWith(`${prefix}/`)) {
      return node.path;
    }
    const child = firstFileUnder(node.children ?? [], prefix);
    if (child) return child;
  }
  return null;
}

export function UnderReviewPanel({
  installed,
  tree,
}: {
  installed: InstalledPack[];
  tree: TreeNode[];
}) {
  const queryClient = useQueryClient();
  const setActivityView = useUiStore((state) => state.setActivitySidebarView);
  const openFileTab = useUiStore((state) => state.openFileTab);
  const openPublishMessage = useUiStore((state) => state.openPublishMessage);
  const pending = installed.filter(
    (pack) => pack.publish_review_status === "pending",
  );

  const refresh = async () => {
    try {
      const packs = await api.hubReconcilePublishRequests();
      queryClient.setQueryData(queryKeys.installedPacks, packs);
      await queryClient.invalidateQueries({ queryKey: queryKeys.messages });
    } catch (error) {
      toast.error("Could not refresh review status", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarPaneHeader
        title="Under Review"
        actions={
          <RefreshButton
            size="icon-xs"
            label="Refresh review status"
            onRefresh={refresh}
          />
        }
      />
      {pending.length === 0 ? (
        <div className="p-3">
          <EmptyState
            variant="dashed"
            icon={<PackageSearch className="size-6" />}
            title="No packs under review"
            description="Submitted packs will stay here until Hub approves or rejects them."
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {pending.map((pack) => {
            const firstFile = firstFileUnder(tree, pack.local_path);
            return (
              <article
                key={pack.pack_id}
                className="rounded-md border border-border bg-card/50 p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{pack.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {pack.pack_id}
                    </p>
                  </div>
                  <Badge variant="accent">
                    {pendingPublishVersionLabel(pack)}
                  </Badge>
                </div>
                {pack.publish_review_created_at && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    Submitted{" "}
                    {new Date(pack.publish_review_created_at).toLocaleString()}
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (firstFile) openFileTab(firstFile, { preview: false });
                      setActivityView("explorer");
                    }}
                  >
                    <FileSearch className="size-4" />
                    Inspect
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!pack.pending_request_id}
                    onClick={() =>
                      pack.pending_request_id &&
                      openPublishMessage(pack.pending_request_id)
                    }
                  >
                    <MessageSquare className="size-4" />
                    Message
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
