import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";

export type PublishPackInput = {
  packId: string;
  version: string;
  description: string;
};

export function usePublishPack() {
  const queryClient = useQueryClient();
  const toastIdRef = useRef<string | number | undefined>(undefined);

  return useMutation({
    mutationFn: async ({
      packId,
      version,
      description,
    }: PublishPackInput) => {
      await api.hubUpdatePackMetadata(packId, description);
      return api.hubPublishPack(packId, version);
    },
    onMutate: () => {
      toastIdRef.current = toast.loading("Uploading knowledge pack to Hub…");
    },
    onSuccess: (_data, variables) => {
      toast.success("Pack submitted for administrator review", {
        id: toastIdRef.current,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.installedPacks,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.packStatus(variables.packId),
      });
    },
    onError: (error: unknown) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubAuth });
      toast.error(appErrorMessage(error, "Could not publish pack"), {
        id: toastIdRef.current,
      });
    },
    onSettled: () => {
      toastIdRef.current = undefined;
    },
  });
}
