import type { InstalledPack } from "@nest/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { packMutationInvalidations, queryKeys } from "@/lib/query-keys";
import { useUiStore } from "@/stores/ui";

function localPathForPack(
  packs: InstalledPack[] | undefined,
  packId: string,
): string {
  return packs?.find((p) => p.pack_id === packId)?.local_path ?? packId;
}

export function usePackLifecycleMutations() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);

  const invalidateAfterPackChange = () => {
    for (const queryKey of packMutationInvalidations) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const resolveLocalPath = (packId: string) =>
    localPathForPack(
      queryClient.getQueryData<InstalledPack[]>(queryKeys.installedPacks),
      packId,
    );

  const exportPack = useMutation({
    mutationFn: ({
      packId,
      destinationPath,
    }: {
      packId: string;
      destinationPath: string;
    }) => api.hubExportPack(packId, destinationPath),
    onSuccess: () => toast.success(t("hub.packExported")),
    onError: (e) =>
      toast.error(t("hub.exportFailed"), {
        description: appErrorMessage(e),
      }),
  });

  const removePack = useMutation({
    mutationFn: (packId: string) => api.hubRemovePack(packId),
    onSuccess: (_status, packId) => {
      clearPathsUnder(resolveLocalPath(packId));
      invalidateAfterPackChange();
      toast.success(t("hub.packRemoved"));
    },
    onError: (e) =>
      toast.error(t("hub.removeFailed"), {
        description: appErrorMessage(e),
      }),
  });

  const renamePack = useMutation({
    mutationFn: ({ packId, name }: { packId: string; name: string }) =>
      api.hubRenamePack(packId, name),
    onSuccess: (_data, vars) => {
      toast.success("Pack renamed");
      // Old path files effectively vanished under the new folder name.
      clearPathsUnder(resolveLocalPath(vars.packId));
      invalidateAfterPackChange();
    },
    onError: (error: unknown) =>
      toast.error(appErrorMessage(error, "Could not rename pack")),
  });

  return { exportPack, removePack, renamePack };
}
