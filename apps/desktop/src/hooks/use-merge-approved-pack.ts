import type { PackMergeResolution } from "@nest/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
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
          queryKey: ["file-diff", pack.pack_id],
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tree }),
        queryClient.invalidateQueries({ queryKey: queryKeys.messages }),
        queryClient.invalidateQueries({ queryKey: queryKeys.messageCount }),
      ]);
      toast.success(`${pack.name} is synced with Hub`, {
        description: `The reviewed v${pack.version} release is now the Source Control baseline.`,
      });
    },
    onError: (error: Error) =>
      toast.error("Could not merge the approved release", {
        description: error.message,
      }),
  });
}
