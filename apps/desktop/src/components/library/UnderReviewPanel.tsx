import type { InstalledPack } from "@nest/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  Loader2,
  PackageSearch,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDestructiveDialog } from "@/components/ui/confirm-destructive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SidebarPaneHeader } from "@/components/ui/sidebar-pane-header";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { refreshAfterPublishReconcile } from "@/lib/hub-query";
import { pendingPublishVersionLabel } from "@/lib/publish-request-labels";
import { queryKeys } from "@/lib/query-keys";

export function UnderReviewPanel({
  installed,
}: {
  installed: InstalledPack[];
}) {
  const queryClient = useQueryClient();
  const authQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const [cancelTarget, setCancelTarget] = useState<InstalledPack | null>(null);
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.allPackStatus });
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
    onError: (error) =>
      toast.error("Could not cancel publish request", {
        description: appErrorMessage(error),
      }),
  });

  const refresh = async () => {
    try {
      await refreshAfterPublishReconcile(queryClient);
    } catch (error) {
      toast.error("Could not refresh review status", {
        description: appErrorMessage(error),
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
                {(pack.pending_submitter_name || pack.pending_submitter_id) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Submitted by {pack.pending_submitter_name ?? pack.pending_submitter_id}
                    {pack.pending_submitter_name && pack.pending_submitter_id
                      ? ` (@${pack.pending_submitter_id})`
                      : ""}
                  </p>
                )}
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Editing is locked until this request is resolved or
                  cancelled.
                </p>
                {pack.pending_can_cancel &&
                  authQuery.data?.authenticated === true && (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full text-destructive hover:text-destructive"
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
                  </div>
                  )}
              </article>
            );
          })}
        </div>
      )}
      <ConfirmDestructiveDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open && !cancelPublish.isPending) setCancelTarget(null);
        }}
        title="Cancel publish request?"
        description={
          <>
            This removes {cancelTarget?.name ?? "the pack"} from the review
            queue and unlocks it for editing. You can submit it again later.
          </>
        }
        cancelLabel="Keep under review"
        confirmLabel={
          cancelPublish.isPending ? "Cancelling…" : "Cancel publish"
        }
        confirming={cancelPublish.isPending}
        onConfirm={() => cancelTarget && cancelPublish.mutate(cancelTarget)}
      />
    </div>
  );
}
