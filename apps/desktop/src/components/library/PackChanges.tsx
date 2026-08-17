import { usePreviewApprovedMerge } from "@/hooks/use-preview-approved-merge";
import { useMergeApprovedPack } from "@/hooks/use-merge-approved-pack";
import type { FileStatus, InstalledPack } from "@nest/shared";
import {
  CircleAlert,
  ArrowUp,
  FileText,
  GitCompare,
  Loader2,
  LockKeyhole,
  Merge,
  Package,
  Undo2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PackMergeDialog } from "@/components/hub/PackMergeDialog";
import { PublishMenuItem } from "@/components/hub/PublishMenuItem";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SectionLabel } from "@/components/ui/section-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LETTER,
  STATUS_TEXT_CLASSES,
} from "@/lib/file-status-ui";
import { afterMenuClose } from "@/lib/menu-actions";
import {
  formatPendingSubmitter,
  pendingPublishVersionLabel,
  publishBlockedReason,
  publishMenuLabel,
} from "@/lib/publish-request-labels";
import { fileMutationInvalidations, queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor";
import { diffTabId, useUiStore } from "@/stores/ui";

export function PackChanges({
  pack,
  statuses,
  authenticated,
  recentlyRejected,
  onPublish,
}: {
  pack: InstalledPack;
  statuses: FileStatus[];
  authenticated: boolean;
  recentlyRejected: boolean;
  onPublish: (pack: InstalledPack) => void;
}) {
  const queryClient = useQueryClient();
  const openDiffTab = useUiStore((s) => s.openDiffTab);
  const openFileTab = useUiStore((s) => s.openFileTab);
  const closeMainTab = useUiStore((s) => s.closeMainTab);
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const openMessagesTab = useUiStore((s) => s.openMessagesTab);
  const setActivityView = useUiStore((s) => s.setActivitySidebarView);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const setEditing = useEditorStore((s) => s.setEditing);
  const setDirty = useEditorStore((s) => s.setDirty);

  const mergeApproved = useMergeApprovedPack();
  const {
    preview: mergePreview,
    setPreview: setMergePreview,
    previewing: previewingMerge,
    previewMerge,
  } = usePreviewApprovedMerge();
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false);

  const previewApprovedMerge = async () => {
    if (!pack.pending_request_id) return;
    await previewMerge(pack.pack_id, pack.pending_request_id);
  };
  const reviewLocked = pack.publish_review_status === "pending";
  const pendingSubmitter = formatPendingSubmitter(pack);

  const openPublish = () => {
    onPublish(pack);
  };
  const renderPublishMenuItem = () => (
    <PublishMenuItem
      pack={pack}
      authenticated={authenticated}
      onSelect={() => afterMenuClose(openPublish)}
    />
  );

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
    onError: (error) =>
      toast.error("Could not discard change", {
        description: appErrorMessage(error),
      }),
  });

  const discardAll = useMutation({
    mutationFn: () => api.hubPackDiscardAll(pack.pack_id),
    onSuccess: () => {
      for (const change of statuses) {
        setDirty(change.path, false);
        if (change.status === "new") {
          clearPathsUnder(change.path);
          setEditing(change.path, false);
        } else {
          closeMainTab(diffTabId(pack.pack_id, change.path));
        }
        void queryClient.invalidateQueries({
          queryKey: queryKeys.file(change.path),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.fileDiff(pack.pack_id, change.path),
        });
        if (change.kind === "image") {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.vaultImage(change.path),
          });
        }
      }
      for (const key of fileMutationInvalidations(pack.pack_id)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      setConfirmDiscardAll(false);
      toast.success(
        statuses.length === 1
          ? "Discarded 1 change"
          : `Discarded ${statuses.length} changes`,
      );
    },
    onError: (error) =>
      toast.error("Could not discard changes", {
        description: appErrorMessage(error),
      }),
  });

  return (
    <section className="space-y-1">
      <PackMergeDialog
        open={Boolean(mergePreview)}
        preview={mergePreview}
        busy={mergeApproved.isPending}
        title={`Merge approved changes into ${pack.name}`}
        onOpenChange={(open) => !open && setMergePreview(null)}
        onApply={(resolutions) => {
          if (!pack.pending_request_id) return;
          mergeApproved.mutate(
            {
              packId: pack.pack_id,
              requestId: pack.pending_request_id,
              resolutions,
              previewToken: mergePreview?.preview_token,
            },
            { onSuccess: () => setMergePreview(null) },
          );
        }}
      />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div onContextMenu={(event) => event.stopPropagation()}>
            <SectionLabel className="flex min-w-0 items-center gap-1.5 px-3 pt-2">
              <Package className="size-3.5 shrink-0 text-primary" />
              <span className="truncate">{pack.name}</span>
              <span className="shrink-0 font-normal normal-case tracking-normal opacity-70">
                ({statuses.length})
              </span>
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
              {statuses.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Discard all changes to ${pack.name}`}
                      disabled={reviewLocked || discardAll.isPending}
                      className="ml-auto shrink-0"
                      onClick={() => setConfirmDiscardAll(true)}
                    >
                      <Undo2
                        className={cn(
                          "size-3.5",
                          discardAll.isPending && "animate-spin",
                        )}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {reviewLocked ? "Locked for review" : "Discard all changes"}
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={publishMenuLabel(authenticated)}
                    disabled={Boolean(pack.pending_version)}
                    className={cn(
                      "-mr-1 shrink-0",
                      statuses.length === 0 && "ml-auto",
                    )}
                    onClick={openPublish}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {publishBlockedReason(pack) ?? publishMenuLabel(authenticated)}
                </TooltipContent>
              </Tooltip>
            </SectionLabel>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {renderPublishMenuItem()}
          {statuses.length > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={reviewLocked || discardAll.isPending}
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmDiscardAll(true)}
              >
                <Undo2 className="size-3.5" />
                Discard All Changes
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <AlertDialog
        open={confirmDiscardAll}
        onOpenChange={(open) => !open && setConfirmDiscardAll(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard all changes to {pack.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This discards {statuses.length}{" "}
              {statuses.length === 1 ? "change" : "changes"} across this pack.
              Edited files revert to their last synced version and new files
              are deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              disabled={discardAll.isPending}
              onClick={() => discardAll.mutate()}
            >
              Discard all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reviewLocked && (
        <div className="mx-3 mb-2 mt-1 border-t border-border/70 pt-2">
          {pack.pending_version && (
            <Badge
              variant="accent"
              className="normal-case tracking-normal"
            >
              {pendingPublishVersionLabel(pack)} under review
            </Badge>
          )}
          <div className="mt-2 flex gap-2 rounded-md border border-accent/30 bg-accent/5 p-2.5">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
            <p className="text-xs leading-5 text-muted-foreground">
              This pack is locked for review. Its submitted changes remain
              visible here, but they cannot be edited or discarded until the
              request{pendingSubmitter ? ` from ${pendingSubmitter}` : ""} is
              resolved
              {pack.pending_can_cancel && (
                <>
                  {" or "}
                  <button
                    type="button"
                    className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                    onClick={() => {
                      setActivityView("reviews");
                      setSidebarOpen(true);
                    }}
                  >
                    cancelled from Under Review
                  </button>
                </>
              )}
              .
            </p>
          </div>
        </div>
      )}
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
              disabled={mergeApproved.isPending || previewingMerge}
              onClick={() => void previewApprovedMerge()}
            >
              {mergeApproved.isPending || previewingMerge ? (
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
                    onContextMenu={(event) => event.stopPropagation()}
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
                          disabled={reviewLocked || discard.isPending}
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
                        {reviewLocked ? "Locked for review" : "Discard changes"}
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
                  {renderPublishMenuItem()}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={reviewLocked || discard.isPending}
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
    </section>
  );
}
