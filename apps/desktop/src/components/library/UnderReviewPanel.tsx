import type { InstalledPack, TreeNode } from "@nest/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  FileSearch,
  Loader2,
  MessageSquare,
  PackageSearch,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SidebarPaneHeader } from "@/components/ui/sidebar-pane-header";
import { api } from "@/lib/api";
import { pendingPublishVersionLabel } from "@/lib/publish-request-labels";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
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
  const authQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const [cancelTarget, setCancelTarget] = useState<InstalledPack | null>(null);
  const setActivityView = useUiStore((state) => state.setActivitySidebarView);
  const openFileTab = useUiStore((state) => state.openFileTab);
  const openPublishMessage = useUiStore((state) => state.openPublishMessage);
  const pending = installed.filter(
    (pack) => pack.publish_review_status === "pending",
  );

  const cancelPublish = useMutation({
    mutationFn: (pack: InstalledPack) => {
      if (!pack.pending_request_id) {
        throw new Error("This publish request is no longer available.");
      }
      return api.hubCancelPublishRequest(pack.pack_id, pack.pending_request_id);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<InstalledPack[]>(
        queryKeys.installedPacks,
        (current) =>
          current?.map((pack) =>
            pack.pack_id === updated.pack_id ? updated : pack,
          ) ?? [updated],
      );
      void queryClient.invalidateQueries({ queryKey: ["pack-status"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messageCount });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.publishReconcile,
      });
      setCancelTarget(null);
      toast.success("Publish request cancelled", {
        description: `${updated.name} is editable again.`,
      });
    },
    onError: (error: Error) =>
      toast.error("Could not cancel publish request", {
        description: error.message,
      }),
  });

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
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Editing is locked until this request is resolved or
                  cancelled.
                </p>
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
                  {pack.pending_can_cancel &&
                    authQuery.data?.authenticated === true && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="col-span-2 text-destructive hover:text-destructive"
                      disabled={cancelPublish.isPending}
                      onClick={() => setCancelTarget(pack)}
                    >
                      {cancelPublish.isPending &&
                      cancelPublish.variables?.pack_id === pack.pack_id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <XCircle className="size-4" />
                      )}
                      Cancel publish request
                    </Button>
                    )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <AlertDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open && !cancelPublish.isPending) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel publish request?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {cancelTarget?.name ?? "the pack"} from the review
              queue and unlocks it for editing. You can submit it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelPublish.isPending}>
              Keep under review
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              disabled={!cancelTarget || cancelPublish.isPending}
              onClick={() => cancelTarget && cancelPublish.mutate(cancelTarget)}
            >
              {cancelPublish.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Cancel publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
