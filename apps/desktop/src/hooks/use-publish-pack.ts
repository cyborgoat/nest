import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";

export type PublishPackInput =
  | {
      kind: "release";
      packId: string;
      version: string;
      description: string;
    }
  | {
      kind: "live_patch";
      packId: string;
      targetVersion: string;
    };

export function usePublishPack() {
  const queryClient = useQueryClient();
  const toastIdRef = useRef<string | number | undefined>(undefined);

  return useMutation({
    mutationFn: async (input: PublishPackInput) => {
      if (input.kind === "release") {
        await api.hubUpdatePackMetadata(input.packId, input.description);
        return api.hubPublishRelease(input.packId, input.version);
      }
      return api.hubPublishLivePatch(input.packId, input.targetVersion);
    },
    onMutate: () => {
      toastIdRef.current = toast.loading("Uploading knowledge pack to Hub…");
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.kind === "live_patch"
          ? "Live patch submitted for review"
          : "Release submitted for administrator review",
        {
          id: toastIdRef.current,
        },
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.installedPacks,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.packStatus(variables.packId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messageCount });
    },
    onError: (error: unknown, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubAuth });
      const fallback =
        variables.kind === "live_patch"
          ? "Could not submit live patch"
          : "Could not publish release";
      const message = appErrorMessage(error, fallback);
      toast.error(
        message.includes("hub_publish_live_patch")
          ? "Restart the desktop app to enable live patch publishing"
          : message,
        {
          id: toastIdRef.current,
        },
      );
    },
    onSettled: () => {
      toastIdRef.current = undefined;
    },
  });
}
