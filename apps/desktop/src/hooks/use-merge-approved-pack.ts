import type { PackMergeResolution } from "@nest/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";

export function useMergeApprovedPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      packId,
      requestId,
      resolutions,
      previewToken,
    }: {
      packId: string;
      requestId: string;
      resolutions?: PackMergeResolution[];
      previewToken?: string;
    }) => api.hubMergeApprovedPack(packId, requestId, resolutions, previewToken),
    onSuccess: async (pack) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.installedPacks }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.packStatus(pack.pack_id),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.packFileDiffs(pack.pack_id),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tree }),
        // The merge replaces the pack's entire local directory with the
        // three-way-merged result and kicks off a re-index server-side
        // (hub_merge_approved_pack calls indexing::schedule on success) —
        // any currently open file's content may be stale, and the index
        // status has changed too.
        queryClient.invalidateQueries({ queryKey: queryKeys.allFiles }),
        queryClient.invalidateQueries({ queryKey: queryKeys.index }),
        queryClient.invalidateQueries({ queryKey: queryKeys.messages }),
        queryClient.invalidateQueries({ queryKey: queryKeys.messageCount }),
      ]);
      toast.success(`${pack.name} is synced with Hub`, {
        description: `The reviewed v${pack.version} release is now the Source Control baseline.`,
      });
    },
    onError: (error) =>
      toast.error("Could not merge the approved release", {
        description: appErrorMessage(error),
      }),
  });
}
