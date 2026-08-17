import type { QueryClient } from "@tanstack/react-query";
import type { InstalledPack } from "@nest/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** Reconcile Hub publish state into the installed-packs cache and refresh
 * related messaging / status queries. One path for Messages, Source Control,
 * and Under Review. */
export async function refreshAfterPublishReconcile(
  queryClient: QueryClient,
): Promise<InstalledPack[]> {
  const reconciled = await api.hubReconcilePublishRequests();
  queryClient.setQueryData(queryKeys.installedPacks, reconciled);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.messages }),
    queryClient.invalidateQueries({ queryKey: queryKeys.messageCount }),
    queryClient.invalidateQueries({ queryKey: queryKeys.allPackStatus }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.sourceControlRejections,
    }),
  ]);
  return reconciled;
}
