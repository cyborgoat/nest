import type { InstalledPack } from "@nest/shared";
import { useQuery } from "@tanstack/react-query";
import { PublishPackDialog } from "@/components/hub/PublishPackDialog";
import { usePublishPack } from "@/hooks/use-publish-pack";
import { api } from "@/lib/api";
import { publishDescriptionDefault } from "@/lib/publish-defaults";
import { queryKeys } from "@/lib/query-keys";
import { useUiStore } from "@/stores/ui";

const REGISTRY_PACK_ID = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

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
  const currentReleaseExists = catalogEntry?.releases?.length
    ? catalogEntry.releases.some(
        (release) => release.version === pack.version && !release.yanked,
      )
    : (catalogEntry?.versions.includes(pack.version) ?? false);
  const canLivePatch =
    currentReleaseExists || (catalogQuery.isError && pack.owner_id != null);
  const isFirstPublish = catalogEntry == null && pack.owner_id == null;
  const changeStatusQuery = useQuery({
    queryKey: queryKeys.packStatus(pack.pack_id),
    queryFn: () => api.hubPackChangeStatus(pack.pack_id),
    enabled: open && !catalogQuery.isLoading && !isFirstPublish,
    retry: 1,
  });
  const publish = usePublishPack();
  const clearPathsUnder = useUiStore((state) => state.clearPathsUnder);
  const migratesLegacyIdentity =
    pack.origin === "local" &&
    (!REGISTRY_PACK_ID.test(pack.pack_id) ||
      pack.pack_id !== pack.pack_id.toLowerCase());

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
      isFirstPublish={isFirstPublish}
      defaultsLoading={
        catalogQuery.isLoading ||
        (!isFirstPublish && changeStatusQuery.isLoading)
      }
      hasFileChanges={
        isFirstPublish
          ? true
          : changeStatusQuery.isSuccess
            ? changeStatusQuery.data.length > 0
            : undefined
      }
      publishing={publish.isPending}
      lockedPendingVersion={pack.pending_version}
      canLivePatch={canLivePatch}
      onPublish={(intent) => {
        publish.mutate(
          { ...intent, packId: pack.pack_id },
          {
            onSuccess: () => onOpenChange(false),
            onSettled: () => {
              if (migratesLegacyIdentity) clearPathsUnder(pack.local_path);
            },
          },
        );
      }}
    />
  );
}
