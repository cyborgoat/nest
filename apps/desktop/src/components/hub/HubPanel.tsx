import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstalledPack, PackProject } from "@nest/shared";
import {
  ArrowUpCircle,
  Check,
  CloudDownload,
  CloudOff,
  FolderInput,
  Package,
  Search,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

export function HubPanel() {
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");

  const hubStatusQuery = useQuery({
    queryKey: ["hub-status"],
    queryFn: api.hubStatus,
    refetchInterval: 15_000,
    retry: 1,
  });

  const hubOnline = hubStatusQuery.data?.online === true;
  const hubOffline = hubStatusQuery.data?.online === false;
  const wasOnlineRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (hubStatusQuery.data == null) return;
    const online = hubStatusQuery.data.online;
    const prev = wasOnlineRef.current;
    wasOnlineRef.current = online;
    // Toast on first known offline, or when connection drops.
    if (!online && prev !== false) {
      toast.warning("Knowledge Hub offline", {
        description:
          hubStatusQuery.data.message ||
          "Catalog unavailable. You can still import a local pack zip.",
      });
    }
  }, [hubStatusQuery.data]);

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

  const installedById = useMemo(() => {
    const map = new Map<string, InstalledPack>();
    for (const p of installedQuery.data ?? []) {
      map.set(p.pack_id, p);
    }
    return map;
  }, [installedQuery.data]);

  const catalogIds = useMemo(
    () => new Set((packsQuery.data ?? []).map((p) => p.id)),
    [packsQuery.data],
  );

  const filteredCatalog = useMemo(() => {
    const packs = packsQuery.data ?? [];
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return packs;
    return packs.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.latest_version.toLowerCase().includes(q),
    );
  }, [packsQuery.data, catalogSearch]);

  const localOnlyInstalled = useMemo(
    () =>
      hubOnline && packsQuery.data
        ? (installedQuery.data ?? []).filter((p) => !catalogIds.has(p.pack_id))
        : [],
    [hubOnline, packsQuery.data, installedQuery.data, catalogIds],
  );

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
    mutationFn: ({
      packId,
      version,
    }: {
      packId: string;
      version: string;
      previousVersion?: string;
    }) => api.hubDownloadPack(packId, version),
    onSuccess: (status, vars) => {
      invalidateAfterPackChange();
      if (vars.previousVersion && vars.previousVersion !== vars.version) {
        toast.success("Pack upgraded", {
          description: `${vars.packId} ${vars.previousVersion} → ${vars.version} (${status.indexed_files} files indexed)`,
        });
      } else {
        toast.success("Pack downloaded", {
          description: `${vars.packId}@${vars.version}: ${status.indexed_files} files indexed`,
        });
      }
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
              Install versioned packs from the remote Knowledge Hub (PyPI-style
              registry) or import a pack zip. One active version per pack lives
              in your vault.
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
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-6 p-4">
          {hubOffline && (
            <section className="space-y-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center">
              <CloudOff className="mx-auto size-6 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">
                Connect to the Knowledge Hub
              </h3>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                Start the Hub service and check the Hub URL in Settings to browse
                available packs from the cloud. You can still import a local pack
                zip anytime.
              </p>
            </section>
          )}

          {!hubOffline && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Hub catalog
              </h3>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search packs…"
                  className="h-9 pl-8"
                />
              </div>
              {packsQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Loading packs…</p>
              )}
              {packsQuery.error && (
                <p className="text-sm text-destructive">
                  {(packsQuery.error as Error).message}
                </p>
              )}
              {filteredCatalog.map((pack, i) => (
                <PackRow
                  key={pack.id}
                  index={i}
                  project={pack}
                  installed={installedById.get(pack.id)}
                  busy={download.isPending || remove.isPending}
                  onInstall={(version) =>
                    download.mutate({
                      packId: pack.id,
                      version,
                      previousVersion: installedById.get(pack.id)?.version,
                    })
                  }
                  onRemove={() => remove.mutate(pack.id)}
                  removePending={remove.isPending}
                />
              ))}
              {packsQuery.data &&
                packsQuery.data.length > 0 &&
                filteredCatalog.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No packs match “{catalogSearch}”.
                  </p>
                )}
              {packsQuery.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">No packs available.</p>
              )}
            </section>
          )}

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
  project,
  installed,
  busy,
  onInstall,
  onRemove,
  removePending,
}: {
  index: number;
  project: PackProject;
  installed?: InstalledPack;
  busy: boolean;
  onInstall: (version: string) => void;
  onRemove: () => void;
  removePending: boolean;
}) {
  const [selectedVersion, setSelectedVersion] = useState(
    project.latest_version,
  );
  const versions = project.versions.length
    ? project.versions
    : [project.latest_version];

  useEffect(() => {
    setSelectedVersion(project.latest_version);
  }, [project.id, project.latest_version]);

  const isInstalled = !!installed;
  const updateAvailable =
    isInstalled && installed.version !== project.latest_version;
  const selectedIsInstalled =
    isInstalled && installed.version === selectedVersion;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group flex items-start justify-between gap-3 border-b border-border pb-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Package className="size-4 text-primary" />
          <h3 className="font-medium">{project.name}</h3>
          <span className="text-xs text-muted-foreground">
            latest {project.latest_version}
          </span>
          {isInstalled && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              installed {installed.version}
            </span>
          )}
          {updateAvailable && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
              Update available
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {project.description}
        </p>
        {versions.length > 1 && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            Version
            <select
              className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground"
              value={selectedVersion}
              onChange={(e) => setSelectedVersion(e.target.value)}
              disabled={busy}
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                  {v === project.latest_version ? " (latest)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="relative flex shrink-0 items-center gap-2">
        {selectedIsInstalled ? (
          <>
            <Button size="sm" variant="secondary" disabled>
              <Check className="size-4" />
              Installed
            </Button>
            {updateAvailable && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => onInstall(project.latest_version)}
              >
                <ArrowUpCircle className="size-4" />
                Upgrade
              </Button>
            )}
            <RemoveHoverButton
              name={project.name}
              disabled={busy || removePending}
              pending={removePending}
              onConfirm={onRemove}
            />
          </>
        ) : (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onInstall(selectedVersion)}
            >
              {isInstalled ? (
                <>
                  <ArrowUpCircle className="size-4" />
                  Install {selectedVersion}
                </>
              ) : (
                <>
                  <CloudDownload className="size-4" />
                  Download
                </>
              )}
            </Button>
            {isInstalled && (
              <RemoveHoverButton
                name={project.name}
                disabled={busy || removePending}
                pending={removePending}
                onConfirm={onRemove}
              />
            )}
          </>
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
