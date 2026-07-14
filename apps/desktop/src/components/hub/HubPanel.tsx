import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstalledPack } from "@nest/shared";
import {
  Check,
  CloudDownload,
  CloudOff,
  FolderInput,
  Package,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ImportPackDialog } from "@/components/hub/ImportPackDialog";
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
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const hubStatusQuery = useQuery({
    queryKey: ["hub-status"],
    queryFn: api.hubStatus,
    refetchInterval: 15_000,
    retry: 1,
  });

  const hubOnline = hubStatusQuery.data?.online === true;
  const hubOffline = hubStatusQuery.data?.online === false;

  const packsQuery = useQuery({
    queryKey: ["packs"],
    queryFn: api.hubListPacks,
    enabled: hubOnline,
    retry: 1,
  });

  const installedQuery = useQuery({
    queryKey: ["installed-packs"],
    queryFn: api.hubListInstalled,
  });

  const catalogIds = useMemo(
    () => new Set((packsQuery.data ?? []).map((p) => p.id)),
    [packsQuery.data],
  );

  /** Packs in the vault that are not in the remote catalog (local imports). */
  const localOnlyInstalled = useMemo(
    () =>
      hubOnline && packsQuery.data
        ? (installedQuery.data ?? []).filter((p) => !catalogIds.has(p.pack_id))
        : [],
    [hubOnline, packsQuery.data, installedQuery.data, catalogIds],
  );

  /** When Hub is offline, catalog rows are hidden — list everything installed for remove. */
  const installedWhileOffline = useMemo(
    () => (hubOffline ? (installedQuery.data ?? []) : []),
    [hubOffline, installedQuery.data],
  );

  const invalidateAfterPackChange = () => {
    queryClient.invalidateQueries({ queryKey: ["tree"] });
    queryClient.invalidateQueries({ queryKey: ["index-status"] });
    queryClient.invalidateQueries({ queryKey: ["installed-packs"] });
    queryClient.invalidateQueries({ queryKey: ["file"] });
    queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
  };

  const download = useMutation({
    mutationFn: (packId: string) => api.hubDownloadPack(packId),
    onSuccess: (status, packId) => {
      invalidateAfterPackChange();
      toast.success("Pack downloaded", {
        description: `${packId}: ${status.indexed_files} files indexed`,
      });
    },
    onError: (e: Error) =>
      toast.error("Download failed", { description: e.message }),
  });

  const importLocal = useMutation({
    mutationFn: (sourcePath: string) => api.hubImportLocalPack(sourcePath),
    onSuccess: (status) => {
      setImportOpen(false);
      invalidateAfterPackChange();
      toast.success("Pack imported", {
        description: `${status.indexed_files} files indexed`,
      });
    },
    onError: (e: Error) =>
      toast.error("Import failed", {
        description: e.message || String(e),
      }),
  });

  const remove = useMutation({
    mutationFn: (packId: string) => api.hubRemovePack(packId),
    onSuccess: (_status, packId) => {
      const localPath =
        installedQuery.data?.find((p) => p.pack_id === packId)?.local_path ??
        packId;
      clearPathsUnder(localPath);
      invalidateAfterPackChange();
      toast.success("Pack removed", {
        description: `${packId} deleted and search index refreshed`,
      });
    },
    onError: (e: Error) =>
      toast.error("Remove failed", {
        description: e.message || String(e),
      }),
  });

  const isDownloaded = (packId: string, packPath: string) =>
    (installedQuery.data ?? []).some(
      (p) => p.pack_id === packId || p.local_path === packPath,
    );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl">Knowledge Hub</h2>
              {hubOnline && (
                <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                  Online
                </span>
              )}
              {hubOffline && (
                <span className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                  <CloudOff className="size-3" />
                  Offline
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Download packs from the remote Knowledge Hub or import a pack zip
              from your computer. Nest stores them as read-only trees in your
              vault.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setImportOpen(true)}
          >
            <FolderInput className="size-4" />
            Import
          </Button>
        </div>
        {hubOffline && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <CloudOff className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">Remote Knowledge Hub is not accessible</p>
              <p className="mt-0.5 text-xs opacity-90">
                {hubStatusQuery.data?.message ||
                  "Start the Hub service or check the Hub URL in Settings. You can still import a local pack zip."}
              </p>
              {hubStatusQuery.data?.hub_base_url && (
                <p className="mt-1 truncate font-mono text-[11px] opacity-80">
                  {hubStatusQuery.data.hub_base_url}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-4">
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Hub catalog
            </h3>
            {packsQuery.isLoading && !hubOffline && (
              <p className="text-sm text-muted-foreground">Loading packs…</p>
            )}
            {hubOffline && (
              <p className="text-sm text-muted-foreground">
                Catalog unavailable while the Hub is offline.
              </p>
            )}
            {!hubOffline && packsQuery.error && (
              <p className="text-sm text-destructive">
                {(packsQuery.error as Error).message}
              </p>
            )}
            {!hubOffline &&
              (packsQuery.data ?? []).map((pack, i) => (
                <PackRow
                  key={pack.id}
                  index={i}
                  title={pack.name}
                  subtitle={`v${pack.version}`}
                  description={pack.description}
                  downloaded={isDownloaded(pack.id, pack.path)}
                  busy={download.isPending || remove.isPending}
                  onDownload={() => download.mutate(pack.id)}
                  onRemove={() => remove.mutate(pack.id)}
                  removePending={remove.isPending}
                />
              ))}
            {!hubOffline && packsQuery.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No packs available.</p>
            )}
          </section>

          {hubOffline && installedWhileOffline.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Installed in vault
              </h3>
              {installedWhileOffline.map((pack, i) => (
                <LocalPackRow
                  key={pack.pack_id}
                  index={i}
                  pack={pack}
                  busy={remove.isPending}
                  onRemove={() => remove.mutate(pack.pack_id)}
                  removePending={remove.isPending}
                />
              ))}
            </section>
          )}

          {!hubOffline && localOnlyInstalled.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Imported locally
              </h3>
              {localOnlyInstalled.map((pack, i) => (
                <LocalPackRow
                  key={pack.pack_id}
                  index={i}
                  pack={pack}
                  busy={remove.isPending}
                  onRemove={() => remove.mutate(pack.pack_id)}
                  removePending={remove.isPending}
                />
              ))}
            </section>
          )}
        </div>
      </ScrollArea>

      <ImportPackDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importing={importLocal.isPending}
        onImport={(path) => importLocal.mutate(path)}
      />
    </div>
  );
}

function PackRow({
  index,
  title,
  subtitle,
  description,
  downloaded,
  busy,
  onDownload,
  onRemove,
  removePending,
}: {
  index: number;
  title: string;
  subtitle: string;
  description: string;
  downloaded: boolean;
  busy: boolean;
  onDownload: () => void;
  onRemove: () => void;
  removePending: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group flex items-start justify-between gap-3 border-b border-border pb-3"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-primary" />
          <h3 className="font-medium">{title}</h3>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="relative flex shrink-0 items-center">
        {downloaded ? (
          <>
            <Button size="sm" variant="secondary" disabled>
              <Check className="size-4" />
              Downloaded
            </Button>
            <RemoveHoverButton
              name={title}
              disabled={busy || removePending}
              pending={removePending}
              onConfirm={onRemove}
            />
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={onDownload}>
            <CloudDownload className="size-4" />
            Download
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function LocalPackRow({
  index,
  pack,
  busy,
  onRemove,
  removePending,
}: {
  index: number;
  pack: InstalledPack;
  busy: boolean;
  onRemove: () => void;
  removePending: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group flex items-start justify-between gap-3 border-b border-border pb-3"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Package className="size-4 text-accent" />
          <h3 className="font-medium">{pack.name}</h3>
          <span className="text-xs text-muted-foreground">v{pack.version}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Local folder · {pack.local_path}
        </p>
      </div>
      <div className="relative flex shrink-0 items-center">
        <Button size="sm" variant="secondary" disabled>
          <Check className="size-4" />
          Imported
        </Button>
        <RemoveHoverButton
          name={pack.name}
          disabled={busy || removePending}
          pending={removePending}
          onConfirm={onRemove}
        />
      </div>
    </motion.div>
  );
}

function RemoveHoverButton({
  name,
  disabled,
  pending,
  onConfirm,
}: {
  name: string;
  disabled: boolean;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="icon"
            variant="destructive"
            className="size-8"
            disabled={disabled}
            title="Remove pack"
            aria-label={`Remove ${name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove knowledge pack?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove “{name}” from your local vault. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
