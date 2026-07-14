import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CloudDownload, Package, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

export function HubPanel() {
  const setStatusMessage = useUiStore((s) => s.setStatusMessage);
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const queryClient = useQueryClient();

  const packsQuery = useQuery({
    queryKey: ["packs"],
    queryFn: api.hubListPacks,
  });

  const installedQuery = useQuery({
    queryKey: ["installed-packs"],
    queryFn: api.hubListInstalled,
  });

  const download = useMutation({
    mutationFn: (packId: string) => api.hubDownloadPack(packId),
    onSuccess: (status, packId) => {
      queryClient.invalidateQueries({ queryKey: ["tree"] });
      queryClient.invalidateQueries({ queryKey: ["index-status"] });
      queryClient.invalidateQueries({ queryKey: ["installed-packs"] });
      setStatusMessage(
        `Downloaded ${packId}: ${status.indexed_files} files indexed`,
      );
    },
    onError: (e: Error) => setStatusMessage(e.message),
  });

  const remove = useMutation({
    mutationFn: (packId: string) => api.hubRemovePack(packId),
    onSuccess: (_status, packId) => {
      const localPath =
        installedQuery.data?.find((p) => p.pack_id === packId)?.local_path ??
        packId;
      clearPathsUnder(localPath);
      queryClient.invalidateQueries({ queryKey: ["tree"] });
      queryClient.invalidateQueries({ queryKey: ["index-status"] });
      queryClient.invalidateQueries({ queryKey: ["installed-packs"] });
      queryClient.invalidateQueries({ queryKey: ["file"] });
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
      setStatusMessage(`Removed pack ${packId} and refreshed the search index`);
    },
    onError: (e: Error) => setStatusMessage(e.message || String(e)),
  });

  const isDownloaded = (packId: string, packPath: string) =>
    (installedQuery.data ?? []).some(
      (p) => p.pack_id === packId || p.local_path === packPath,
    );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-display text-xl">Knowledge Hub</h2>
        <p className="text-sm text-muted-foreground">
          Browse packs from the knowledge hub. Nest downloads them as read-only Markdown trees.
          If the hub is offline, the local catalog is used when available.
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {packsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Loading packs…</p>
          )}
          {packsQuery.error && (
            <p className="text-sm text-destructive">
              {(packsQuery.error as Error).message}
            </p>
          )}
          {(packsQuery.data ?? []).map((pack, i) => {
            const downloaded = isDownloaded(pack.id, pack.path);
            return (
              <motion.div
                key={pack.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="group flex items-start justify-between gap-3 border-b border-border pb-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Package className="size-4 text-primary" />
                    <h3 className="font-medium">{pack.name}</h3>
                    <span className="text-xs text-muted-foreground">v{pack.version}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{pack.description}</p>
                </div>
                <div className="relative flex shrink-0 items-center">
                  {downloaded ? (
                    <>
                      <Button size="sm" variant="secondary" disabled>
                        <Check className="size-4" />
                        Downloaded
                      </Button>
                      <div className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="destructive"
                              className="size-8"
                              disabled={remove.isPending}
                              title="Remove pack"
                              aria-label={`Remove ${pack.name}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove knowledge pack?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove “{pack.name}” from your local
                                vault. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className={cn(buttonVariants({ variant: "destructive" }))}
                                disabled={remove.isPending}
                                onClick={() => remove.mutate(pack.id)}
                              >
                                {remove.isPending ? "Removing…" : "Remove"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={download.isPending}
                      onClick={() => download.mutate(pack.id)}
                    >
                      <CloudDownload className="size-4" />
                      Download
                    </Button>
                  )}
                </div>
              </motion.div>
            );
          })}
          {packsQuery.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No packs available.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
