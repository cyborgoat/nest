import type { FileStatus, InstalledPack } from "@nest/shared";
import {
  CircleAlert,
  CloudUpload,
  FileText,
  GitBranch,
  GitCompare,
  Loader2,
  Merge,
  Package,
  Undo2,
} from "lucide-react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PackPublishDialogController } from "@/components/hub/PackPublishDialogController";
import { useMergeApprovedPack } from "@/hooks/use-merge-approved-pack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SectionLabel } from "@/components/ui/section-label";
import { SidebarPaneHeader } from "@/components/ui/sidebar-pane-header";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LETTER,
  STATUS_TEXT_CLASSES,
} from "@/lib/file-status-ui";
import { canEditPack } from "@/lib/pack-permissions";
import { pendingPublishVersionLabel } from "@/lib/publish-request-labels";
import { fileMutationInvalidations, queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor";
import { diffTabId, useUiStore } from "@/stores/ui";

function PackChanges({
  pack,
  statuses,
  authenticated,
  recentlyRejected,
}: {
  pack: InstalledPack;
  statuses: FileStatus[];
  authenticated: boolean;
  recentlyRejected: boolean;
}) {
  const queryClient = useQueryClient();
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const openDiffTab = useUiStore((s) => s.openDiffTab);
  const openFileTab = useUiStore((s) => s.openFileTab);
  const closeMainTab = useUiStore((s) => s.closeMainTab);
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const openAccountSettingsTab = useUiStore((s) => s.openAccountSettingsTab);
  const openMessagesTab = useUiStore((s) => s.openMessagesTab);
  const setEditing = useEditorStore((s) => s.setEditing);
  const setDirty = useEditorStore((s) => s.setDirty);

  const mergeApproved = useMergeApprovedPack();

  const discard = useMutation({
    mutationFn: (change: FileStatus) =>
      api.hubPackDiscardFile(pack.pack_id, change.path),
    onSuccess: (_data, change) => {
      setDirty(change.path, false);
      if (change.status === "new") {
        clearPathsUnder(change.path);
        setEditing(change.path, false);
      } else {
        closeMainTab(diffTabId(pack.pack_id, change.path));
      }
      for (const key of fileMutationInvalidations(pack.pack_id, change.path)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.fileDiff(pack.pack_id, change.path),
      });
      if (change.kind === "image") {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.vaultImage(change.path),
        });
      }
      toast.success("Change discarded");
    },
    onError: (error: Error) =>
      toast.error("Could not discard change", {
        description: error.message,
      }),
  });

  return (
    <section className="space-y-1">
      <SectionLabel className="flex min-w-0 items-center gap-1.5 px-3 pt-2">
        <Package className="size-3.5 text-primary" />
        <span className="truncate">{pack.name}</span>
        <span className="shrink-0 font-normal normal-case tracking-normal opacity-70">
          ({statuses.length})
        </span>
        {pack.publish_review_status === "pending" && pack.pending_version && (
          <Badge
            variant="accent"
            className="shrink-0 normal-case tracking-normal"
          >
            {pendingPublishVersionLabel(pack)} under review
          </Badge>
        )}
        {pack.publish_review_status === "approved_awaiting_merge" &&
          pack.pending_version && (
            <Badge
              variant="update"
              className="shrink-0 normal-case tracking-normal"
            >
              {pendingPublishVersionLabel(pack)} approved
            </Badge>
          )}
        {recentlyRejected && !pack.pending_version && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={openMessagesTab}>
                <Badge
                  variant="destructive"
                  className="shrink-0 normal-case tracking-normal"
                >
                  <CircleAlert className="size-3" />
                  Rejected
                </Badge>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Recent publish rejected. Open Messages for details.
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={authenticated ? "Publish pack" : "Sign in to publish"}
              disabled={Boolean(pack.pending_version)}
              className="ml-auto -mr-1 shrink-0"
              onClick={() => {
                if (authenticated) setPublishDialogOpen(true);
                else openAccountSettingsTab();
              }}
            >
              <CloudUpload className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {pack.pending_version
              ? pack.publish_review_status === "approved_awaiting_merge"
                ? `${pendingPublishVersionLabel(pack)} is approved and ready to merge`
                : `${pendingPublishVersionLabel(pack)} is awaiting review`
              : authenticated
                ? "Publish pack"
                : "Sign in to publish"}
          </TooltipContent>
        </Tooltip>
      </SectionLabel>
      {pack.publish_review_status === "approved_awaiting_merge" &&
        pack.pending_request_id && (
          <div className="mx-3 mb-2 rounded-md border border-success/30 bg-success/5 p-2.5">
            <p className="text-xs leading-5 text-muted-foreground">
              The reviewed Hub release is ready to become this pack’s remote
              baseline. Local files will be preserved.
            </p>
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={mergeApproved.isPending}
              onClick={() =>
                mergeApproved.mutate({
                  packId: pack.pack_id,
                  requestId: pack.pending_request_id!,
                })
              }
            >
              {mergeApproved.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Merge className="size-4" />
              )}
              Merge with remote
            </Button>
          </div>
        )}
      {statuses.length > 0 && (
        <div className="ml-3 border-l border-border/60 pb-2">
          {statuses.map((s) => {
            const relativePath = s.path.startsWith(`${pack.local_path}/`)
              ? s.path.slice(pack.local_path.length + 1)
              : s.path;
            const pathParts = relativePath.split("/");
            const filename = pathParts.pop() ?? relativePath;
            const parentPath = pathParts.join("/");
            const selected =
              activeMainTabId === diffTabId(pack.pack_id, s.path);
            const discarding =
              discard.isPending && discard.variables?.path === s.path;

            return (
              <ContextMenu key={s.path}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      "group flex w-full items-center rounded-md pr-2 text-sm transition-colors hover:bg-muted/80",
                      selected && "bg-muted/80",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openDiffTab(pack.pack_id, s.path)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-3 text-left"
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                        <span
                          className={cn(
                            "max-w-[60%] shrink-0 truncate",
                            STATUS_TEXT_CLASSES[s.status],
                          )}
                        >
                          {filename}
                        </span>
                        {parentPath && (
                          <span className="truncate text-xs text-muted-foreground">
                            {parentPath}
                          </span>
                        )}
                      </span>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Discard changes to ${filename}`}
                          disabled={discard.isPending}
                          className={cn(
                            "shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
                            selected && "opacity-100",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            discard.mutate(s);
                          }}
                        >
                          <Undo2
                            className={cn(
                              "size-3.5",
                              discarding && "animate-spin",
                            )}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        Discard changes
                      </TooltipContent>
                    </Tooltip>
                    <Badge
                      variant={STATUS_BADGE_VARIANT[s.status]}
                      className="ml-1 shrink-0 px-1 py-0 text-[10px] leading-4"
                    >
                      {STATUS_LETTER[s.status]}
                    </Badge>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => openDiffTab(pack.pack_id, s.path)}
                  >
                    <GitCompare className="size-3.5" />
                    Open Changes
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={
                      s.status === "deleted" ||
                      !s.path.toLowerCase().endsWith(".md")
                    }
                    onSelect={() => openFileTab(s.path, { preview: false })}
                  >
                    <FileText className="size-3.5" />
                    Open File
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={discard.isPending}
                    className="text-destructive focus:text-destructive"
                    onSelect={() => discard.mutate(s)}
                  >
                    <Undo2 className="size-3.5" />
                    Discard Changes
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}
      <PackPublishDialogController
        pack={pack}
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
      />
    </section>
  );
}

export function SourceControlPanel({
  installed,
}: {
  installed: InstalledPack[];
}) {
  const queryClient = useQueryClient();
  const hubAuthQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const hubUser = hubAuthQuery.data?.user ?? null;
  const authenticated = hubAuthQuery.data?.authenticated === true;

  // Get fresh "under review" state as soon as this view is opened, rather
  // than waiting for the background poll.
  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.publishReconcile,
    });
  }, [queryClient]);

  const rejectionQuery = useQuery({
    queryKey: queryKeys.sourceControlRejections,
    queryFn: () => api.hubListMessages("unread"),
    enabled: authenticated,
    refetchInterval: 30_000,
  });
  const recentlyRejectedPackIds = useMemo(
    () =>
      new Set(
        (rejectionQuery.data?.items ?? [])
          .filter(
            (message) =>
              message.kind === "publish_rejected" && Boolean(message.pack_id),
          )
          .map((message) => message.pack_id!),
      ),
    [rejectionQuery.data],
  );

  const editablePacks = useMemo(
    () => installed.filter((p) => canEditPack(p, hubUser)),
    [installed, hubUser],
  );

  const statusQueries = useQueries({
    queries: editablePacks.map((pack) => ({
      queryKey: queryKeys.packStatus(pack.pack_id),
      queryFn: () => api.hubPackChangeStatus(pack.pack_id),
    })),
  });

  const sections = editablePacks
    .map((pack, i) => ({ pack, statuses: statusQueries[i]?.data ?? [] }))
    .filter(
      (s) =>
        s.statuses.length > 0 ||
        s.pack.publish_review_status === "approved_awaiting_merge",
    );

  const refreshCloudStatus = async () => {
    const refreshedPacks = await api.hubReconcilePublishRequests();
    queryClient.setQueryData(queryKeys.installedPacks, refreshedPacks);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pack-status"] }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourceControlRejections,
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.messageCount }),
    ]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarPaneHeader
        title="Source Control"
        actions={
          <RefreshButton
            size="icon-xs"
            label="Sync cloud status"
            refreshing={rejectionQuery.isFetching}
            onRefresh={refreshCloudStatus}
          />
        }
      />
      {sections.length === 0 ? (
        <div className="p-3">
          <EmptyState
            variant="dashed"
            icon={<GitBranch className="size-6" />}
            title="No changes to review"
            description="Source control shows changes for knowledge packs you own."
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {sections.map(({ pack, statuses }) => (
            <PackChanges
              key={pack.pack_id}
              pack={pack}
              statuses={statuses}
              authenticated={authenticated}
              recentlyRejected={recentlyRejectedPackIds.has(pack.pack_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
