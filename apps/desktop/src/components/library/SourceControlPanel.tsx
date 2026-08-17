import { refreshAfterPublishReconcile } from "@/lib/hub-query";
import type { InstalledPack } from "@nest/shared";
import {
  ArrowUp,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import {
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PackPublishDialogController } from "@/components/hub/PackPublishDialogController";
import { PackChanges } from "@/components/library/PackChanges";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SidebarPaneHeader } from "@/components/ui/sidebar-pane-header";
import { api } from "@/lib/api";
import {
  hasPackEditPermission,
  shouldTrackPackChanges,
} from "@/lib/pack-permissions";
import { afterMenuClose } from "@/lib/menu-actions";
import { publishMenuLabel } from "@/lib/publish-request-labels";
import { queryKeys } from "@/lib/query-keys";
import { useUiStore } from "@/stores/ui";

export function SourceControlPanel({
  installed,
}: {
  installed: InstalledPack[];
}) {
  const queryClient = useQueryClient();
  const [publishPack, setPublishPack] = useState<InstalledPack | null>(null);
  const hubAuthQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const hubUser = hubAuthQuery.data?.user ?? null;
  const authenticated = hubAuthQuery.data?.authenticated === true;
  const openAccountTab = useUiStore((s) => s.openAccountTab);
  const openHubInstalledTab = useUiStore((s) => s.openHubInstalledTab);
  const catalogQuery = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.hubListPacks,
  });
  const patchUpdates = useMemo(() => {
    const projects = new Map((catalogQuery.data ?? []).map((pack) => [pack.id, pack]));
    return installed.flatMap((pack) => {
      const release = projects
        .get(pack.pack_id)
        ?.releases.find((candidate) => candidate.version === pack.version);
      return release && !release.yanked && release.patch_revision > pack.patch_revision
        ? [{ pack, patchRevision: release.patch_revision }]
        : [];
    });
  }, [catalogQuery.data, installed]);

  const openPublish = (pack: InstalledPack) => {
    if (authenticated) setPublishPack(pack);
    else openAccountTab();
  };

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

  const sourceControlPacks = useMemo(
    () =>
      installed.filter(
        (pack) =>
          shouldTrackPackChanges(pack, hubUser) ||
          (pack.publish_review_status === "approved_awaiting_merge" &&
            hasPackEditPermission(pack, hubUser)),
      ),
    [installed, hubUser],
  );

  const statusQueries = useQueries({
    queries: sourceControlPacks.map((pack) => ({
      queryKey: queryKeys.packStatus(pack.pack_id),
      queryFn: () => api.hubPackChangeStatus(pack.pack_id),
      enabled: shouldTrackPackChanges(pack, hubUser),
    })),
  });

  const sections = sourceControlPacks
    .map((pack, i) => ({ pack, statuses: statusQueries[i]?.data ?? [] }))
    .filter(
      (s) =>
        s.statuses.length > 0 ||
        s.pack.publish_review_status === "pending" ||
        s.pack.publish_review_status === "approved_awaiting_merge",
    );

  const refreshCloudStatus = async () => {
    await refreshAfterPublishReconcile(queryClient);
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {patchUpdates.map(({ pack, patchRevision }) => (
              <div
                key={`patch-${pack.pack_id}`}
                className="mx-2 mb-2 rounded-md border border-success/30 bg-success/5 p-2.5"
              >
                <p className="text-xs font-medium">Patch {patchRevision} available for {pack.name}</p>
                <Button size="sm" variant="outline" className="mt-2 w-full" onClick={openHubInstalledTab}>
                  <RefreshCw className="size-3.5" />
                  Review patch
                </Button>
              </div>
            ))}
            {sections.length === 0 && patchUpdates.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  variant="dashed"
                  icon={<GitBranch className="size-6" />}
                  title="No changes to review"
                  description="Source control shows changes for editable packs installed from the registry."
                />
              </div>
            ) : (
              sections.map(({ pack, statuses }) => (
                <PackChanges
                  key={pack.pack_id}
                  pack={pack}
                  statuses={statuses}
                  authenticated={authenticated}
                  recentlyRejected={recentlyRejectedPackIds.has(pack.pack_id)}
                  onPublish={openPublish}
                />
              ))
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {sections.length === 0 ? (
            <ContextMenuItem disabled>No packs to publish</ContextMenuItem>
          ) : (
            sections.map(({ pack }) => (
              <ContextMenuItem
                key={pack.pack_id}
                disabled={Boolean(pack.pending_version)}
                onSelect={() => afterMenuClose(() => openPublish(pack))}
              >
                <ArrowUp className="size-3.5" />
                {publishMenuLabel(authenticated)} “{pack.name}”
              </ContextMenuItem>
            ))
          )}
        </ContextMenuContent>
      </ContextMenu>
      {publishPack && (
        <PackPublishDialogController
          pack={publishPack}
          open
          onOpenChange={(open) => {
            if (!open) setPublishPack(null);
          }}
        />
      )}
    </div>
  );
}
