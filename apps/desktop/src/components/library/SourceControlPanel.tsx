import type { FileStatus, InstalledPack } from "@nest/shared";
import { FileText, GitBranch, Package } from "lucide-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionLabel } from "@/components/ui/section-label";
import { SidebarPaneHeader } from "@/components/ui/sidebar-pane-header";
import { api } from "@/lib/api";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LETTER,
  STATUS_TEXT_CLASSES,
} from "@/lib/file-status-ui";
import { canEditPack } from "@/lib/pack-permissions";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

function PackChanges({
  pack,
  statuses,
}: {
  pack: InstalledPack;
  statuses: FileStatus[];
}) {
  const openDiffTab = useUiStore((s) => s.openDiffTab);
  if (statuses.length === 0) return null;

  return (
    <section className="space-y-1">
      <SectionLabel className="flex items-center gap-1.5 px-3 pt-2">
        <Package className="size-3.5 text-primary" />
        {pack.name}
        <span className="font-normal normal-case tracking-normal opacity-70">
          ({statuses.length})
        </span>
        {pack.pending_version && (
          <Badge variant="accent" className="normal-case tracking-normal">
            v{pack.pending_version} under review
          </Badge>
        )}
      </SectionLabel>
      <div className="pb-2">
        {statuses.map((s) => {
          return (
            <button
              key={s.path}
              type="button"
              onClick={() => openDiffTab(pack.pack_id, s.path)}
              className="flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted/80"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span
                className={cn("truncate", STATUS_TEXT_CLASSES[s.status])}
              >
                {s.path.slice(pack.local_path.length + 1)}
              </span>
              <Badge
                variant={STATUS_BADGE_VARIANT[s.status]}
                className="ml-auto shrink-0 px-1 py-0 text-[10px] leading-4"
              >
                {STATUS_LETTER[s.status]}
              </Badge>
            </button>
          );
        })}
      </div>
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

  // Get fresh "under review" state as soon as this view is opened, rather
  // than waiting for the background poll.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.publishReconcile });
  }, [queryClient]);

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
    .filter((s) => s.statuses.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarPaneHeader title="Source Control" />
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
            <PackChanges key={pack.pack_id} pack={pack} statuses={statuses} />
          ))}
        </div>
      )}
    </div>
  );
}
