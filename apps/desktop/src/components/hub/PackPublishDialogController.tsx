import type { InstalledPack } from "@nest/shared";
import { useQuery } from "@tanstack/react-query";
import { PublishPackDialog } from "@/components/hub/PublishPackDialog";
import { usePublishPack } from "@/hooks/use-publish-pack";
import { api } from "@/lib/api";
import { publishDescriptionDefault } from "@/lib/publish-defaults";
import { queryKeys } from "@/lib/query-keys";

export function PackPublishDialogController({
  pack,
  open,
  onOpenChange,
}: {
  pack: InstalledPack;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const catalogQuery = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.hubListPacks,
    enabled: open,
    retry: 1,
  });
  const catalogEntry = catalogQuery.data?.find(
    (project) => project.id === pack.pack_id,
  );
  const canLivePatch = catalogEntry != null || pack.owner_id != null;
  const availableReleases =
    catalogEntry?.releases
      ?.filter((release) => !release.yanked)
      .map((release) => release.version) ??
    catalogEntry?.versions ??
    [];
  const publish = usePublishPack();

  return (
    <PublishPackDialog
      open={open}
      onOpenChange={onOpenChange}
      packName={pack.name}
      currentVersion={pack.version}
      currentDescription={publishDescriptionDefault(
        catalogEntry,
        pack.description,
      )}
      isFirstPublish={catalogEntry == null && pack.owner_id == null}
      defaultsLoading={catalogQuery.isLoading}
      publishing={publish.isPending}
      lockedPendingVersion={pack.pending_version}
      canLivePatch={canLivePatch}
      availableReleases={availableReleases}
      onPublish={(intent) => {
        publish.mutate(
          { ...intent, packId: pack.pack_id },
          { onSuccess: () => onOpenChange(false) },
        );
      }}
    />
  );
}
