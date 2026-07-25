import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InstalledPack,
  KnowledgePackMeta,
  PackProject,
} from "@nest/shared";
import { CloudOff, FolderInput, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BrowseTab } from "@/components/hub/BrowseTab";
import { ImportPackDialog } from "@/components/hub/ImportPackDialog";
import { InstalledTab } from "@/components/hub/InstalledTab";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/ui/panel-header";
import { RefreshButton } from "@/components/ui/refresh-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { packMutationInvalidations, queryKeys } from "@/lib/query-keys";
import { useI18n } from "@/lib/i18n";
import { useUiStore } from "@/stores/ui";

export function HubPanel() {
  const { t } = useI18n();
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const openAccountSettingsTab = useUiStore(
    (s) => s.openAccountSettingsTab,
  );
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [tab, setTab] = useState<"browse" | "installed">("browse");
  const [pendingPackUpdate, setPendingPackUpdate] = useState<{
    packId: string;
    packName: string;
    version: string;
    previousVersion: string;
    ownerId?: string | null;
  } | null>(null);
  const [pendingOverwrite, setPendingOverwrite] = useState<{
    kind: "zip" | "folder";
    sourcePath: string;
    metadata: KnowledgePackMeta;
    installed: InstalledPack;
  } | null>(null);

  const hubStatusQuery = useQuery({
    queryKey: queryKeys.hubStatus,
    queryFn: api.hubStatus,
    refetchInterval: 15_000,
    retry: 1,
  });

  const hubOnline = hubStatusQuery.data?.online === true;
  const hubOffline = hubStatusQuery.data?.online === false;
  const wasOnlineRef = useRef<boolean | null>(null);
  const publishToastRef = useRef<string | number | undefined>(undefined);

  useEffect(() => {
    if (hubStatusQuery.data == null) return;
    const online = hubStatusQuery.data.online;
    const prev = wasOnlineRef.current;
    wasOnlineRef.current = online;
    // Toast on first known offline, or when connection drops.
    if (!online && prev !== false) {
      toast.warning(t("hub.offlineToastTitle"), {
        description:
          hubStatusQuery.data.message || t("hub.offlineToastDescription"),
      });
    }
  }, [hubStatusQuery.data, t]);

  const authQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });

  const packsQuery = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.hubListPacks,
    enabled: hubOnline && !authQuery.isLoading,
    retry: 1,
  });

  const installedQuery = useQuery({
    queryKey: queryKeys.installedPacks,
    queryFn: api.hubListInstalled,
  });

  const installedById = useMemo(() => {
    const map = new Map<string, InstalledPack>();
    for (const p of installedQuery.data ?? []) {
      map.set(p.pack_id, p);
    }
    return map;
  }, [installedQuery.data]);

  const catalogById = useMemo(() => {
    if (!hubOnline || !packsQuery.data) return null;
    const map = new Map<string, PackProject>();
    for (const p of packsQuery.data) {
      map.set(p.id, p);
    }
    return map;
  }, [hubOnline, packsQuery.data]);

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

  const invalidateAfterPackChange = () => {
    for (const queryKey of packMutationInvalidations) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const refreshHub = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.hubStatus }),
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog }),
      queryClient.invalidateQueries({ queryKey: queryKeys.installedPacks }),
      queryClient.invalidateQueries({ queryKey: queryKeys.publishReconcile }),
    ]);
  };

  const download = useMutation({
    mutationFn: ({
      packId,
      version,
      ownerId,
    }: {
      packId: string;
      version: string;
      previousVersion?: string;
      ownerId?: string | null;
    }) => api.hubDownloadPack(packId, version, ownerId),
    onSuccess: (_status, vars) => {
      invalidateAfterPackChange();
      if (vars.previousVersion && vars.previousVersion !== vars.version) {
        toast.success(t("hub.packUpgraded"));
      } else {
        toast.success(t("hub.packDownloaded"));
      }
    },
    onError: (e: Error) =>
      toast.error(t("hub.downloadFailed"), { description: e.message }),
  });

  const requestDownload = ({
    packId,
    version,
    previousVersion,
    ownerId,
  }: {
    packId: string;
    version: string;
    previousVersion?: string;
    ownerId?: string | null;
  }) => {
    if (
      previousVersion &&
      comparePackVersions(version, previousVersion) > 0
    ) {
      setPendingPackUpdate({
        packId,
        packName: installedById.get(packId)?.name ?? packId,
        version,
        previousVersion,
        ownerId,
      });
      return;
    }

    download.mutate({ packId, version, previousVersion, ownerId });
  };

  const importLocal = useMutation({
    mutationFn: ({
      sourcePath,
      overwrite,
    }: {
      sourcePath: string;
      overwrite: boolean;
    }) => api.hubImportLocalPack(sourcePath, overwrite),
    onSuccess: () => {
      setPendingOverwrite(null);
      setImportOpen(false);
      invalidateAfterPackChange();
      toast.success(t("hub.packImported"));
    },
    onError: (e: Error) =>
      toast.error(t("hub.importFailed"), {
        description: e.message || String(e),
      }),
  });

  const inspectLocal = useMutation({
    mutationFn: api.hubInspectLocalPack,
    onSuccess: (metadata, sourcePath) => {
      const installed = installedById.get(metadata.id);
      if (installed) {
        setPendingOverwrite({
          kind: "zip",
          sourcePath,
          metadata,
          installed,
        });
      } else {
        importLocal.mutate({ sourcePath, overwrite: false });
      }
    },
    onError: (e: Error) =>
      toast.error(t("hub.importFailed"), {
        description: e.message || String(e),
      }),
  });

  const createFromFolder = useMutation({
    mutationFn: ({
      sourcePath,
      metadata,
      overwrite,
    }: {
      sourcePath: string;
      metadata: KnowledgePackMeta;
      overwrite: boolean;
    }) => api.hubCreatePackFromFolder(sourcePath, metadata, overwrite),
    onSuccess: () => {
      setPendingOverwrite(null);
      setImportOpen(false);
      invalidateAfterPackChange();
      toast.success(t("hub.packCreated"));
    },
    onError: (e: Error) =>
      toast.error(t("hub.createFailed"), {
        description: e.message || String(e),
      }),
  });

  const exportPack = useMutation({
    mutationFn: ({
      packId,
      destinationPath,
    }: {
      packId: string;
      destinationPath: string;
    }) => api.hubExportPack(packId, destinationPath),
    onSuccess: () => toast.success(t("hub.packExported")),
    onError: (e: Error) =>
      toast.error(t("hub.exportFailed"), {
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
      toast.success(t("hub.packRemoved"));
    },
    onError: (e: Error) =>
      toast.error(t("hub.removeFailed"), {
        description: e.message || String(e),
      }),
  });

  const publish = useMutation({
    mutationFn: async ({
      packId,
      version,
      description,
    }: {
      packId: string;
      version: string;
      description: string;
    }) => {
      // Save the (possibly edited) description before submitting, so the
      // publish payload reflects it and it's remembered locally too.
      await api.hubUpdatePackMetadata(packId, description);
      return api.hubPublishPack(packId, version);
    },
    onMutate: () => {
      publishToastRef.current = toast.loading(
        "Uploading knowledge pack to Hub…",
      );
    },
    onSuccess: (_data, vars) => {
      toast.success("Pack submitted for administrator review", {
        id: publishToastRef.current,
      });
      publishToastRef.current = undefined;
      // Refresh the install list to pick up the new pending marker — the
      // version/diff baseline itself doesn't move until the request is
      // approved (see hub_reconcile_publish_requests).
      queryClient.invalidateQueries({ queryKey: queryKeys.installedPacks });
      queryClient.invalidateQueries({
        queryKey: queryKeys.packStatus(vars.packId),
      });
    },
    onError: (error: unknown) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubAuth });
      toast.error(appErrorMessage(error, "Could not publish pack"), {
        id: publishToastRef.current,
      });
      publishToastRef.current = undefined;
    },
  });

  const rename = useMutation({
    mutationFn: ({ packId, name }: { packId: string; name: string }) =>
      api.hubRenamePack(packId, name),
    onSuccess: (_data, vars) => {
      toast.success("Pack renamed");
      // The old path's files effectively vanished (they now live under the
      // new folder name) — close any tabs still pointing at them.
      const oldLocalPath =
        installedQuery.data?.find((p) => p.pack_id === vars.packId)
          ?.local_path ?? vars.packId;
      clearPathsUnder(oldLocalPath);
      invalidateAfterPackChange();
    },
    onError: (error: unknown) =>
      toast.error(appErrorMessage(error, "Could not rename pack")),
  });

  const busy =
    download.isPending ||
    remove.isPending ||
    createFromFolder.isPending ||
    importLocal.isPending ||
    exportPack.isPending ||
    publish.isPending ||
    rename.isPending;
  const importing =
    importLocal.isPending ||
    createFromFolder.isPending ||
    inspectLocal.isPending;
  const downloadPendingId = download.isPending
    ? download.variables?.packId
    : undefined;
  const removePendingId = remove.isPending ? remove.variables : undefined;
  const installedCount = installedQuery.data?.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={t("hub.title")}
        description={t("hub.description")}
        badges={
          <>
            {hubOnline && <Badge variant="accent">{t("hub.online")}</Badge>}
            {hubOffline && (
              <Badge variant="destructive">
                <CloudOff className="size-3" />
                {t("hub.offline")}
              </Badge>
            )}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton
              onRefresh={refreshHub}
              refreshing={
                hubStatusQuery.isFetching ||
                packsQuery.isFetching ||
                installedQuery.isFetching
              }
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setImportOpen(true)}
            >
              <FolderInput className="size-4" />
              {t("hub.import")}
            </Button>
          </div>
        }
      />

      {!authQuery.isLoading && !authQuery.data?.authenticated && (
        <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Info className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Nest works locally without an account
            </p>
            <p className="text-xs text-muted-foreground">
              Create an account or sign in only when you want to publish a pack
              or access restricted knowledge packs.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={openAccountSettingsTab}
          >
            Sign in or register
          </Button>
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "browse" | "installed")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-4 pt-3">
          <TabsList>
            <TabsTrigger value="browse">{t("hub.browse")}</TabsTrigger>
            <TabsTrigger value="installed">
              {t("hub.installedCount", { count: installedCount })}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="browse" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="p-4">
              <BrowseTab
                hubOffline={hubOffline}
                packs={packsQuery.data}
                filteredPacks={filteredCatalog}
                packsLoading={packsQuery.isLoading}
                packsError={packsQuery.error as Error | null}
                search={catalogSearch}
                onSearchChange={setCatalogSearch}
                installedById={installedById}
                busy={busy}
                downloadPendingId={downloadPendingId}
                removePendingId={removePendingId}
                onInstall={(packId, version, previousVersion, ownerId) =>
                  requestDownload({
                    packId,
                    version,
                    previousVersion,
                    ownerId,
                  })
                }
                onRemove={(packId) => remove.mutate(packId)}
                onExport={(packId, destinationPath) =>
                  exportPack.mutate({ packId, destinationPath })
                }
                onOpenImport={() => setImportOpen(true)}
              />
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="installed" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="p-4">
              <InstalledTab
                installed={installedQuery.data ?? []}
                isLoading={installedQuery.isLoading}
                hubOnline={hubOnline}
                catalogById={catalogById}
                busy={busy}
                downloadPendingId={downloadPendingId}
                removePendingId={removePendingId}
                onUpgrade={(packId, version, previousVersion, ownerId) =>
                  requestDownload({
                    packId,
                    version,
                    previousVersion,
                    ownerId,
                  })
                }
                onRemove={(packId) => remove.mutate(packId)}
                onOpenImport={() => setImportOpen(true)}
                onBrowse={() => setTab("browse")}
                onExport={(packId, destinationPath) =>
                  exportPack.mutate({ packId, destinationPath })
                }
                authenticated={authQuery.data?.authenticated === true}
                hubUser={authQuery.data?.user ?? null}
                onSignIn={openAccountSettingsTab}
                onPublish={(packId, version, description) =>
                  publish.mutate({ packId, version, description })
                }
                publishing={publish.isPending}
                onRename={(packId, name) => rename.mutate({ packId, name })}
                renaming={rename.isPending}
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <ImportPackDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importing={importing}
        onImportZip={(path) => inspectLocal.mutate(path)}
        onCreateFromFolder={(sourcePath, metadata) => {
          const installed = installedById.get(metadata.id.trim());
          if (installed) {
            setPendingOverwrite({
              kind: "folder",
              sourcePath,
              metadata,
              installed,
            });
          } else {
            createFromFolder.mutate({
              sourcePath,
              metadata,
              overwrite: false,
            });
          }
        }}
      />
      <AlertDialog
        open={Boolean(pendingPackUpdate)}
        onOpenChange={(open) => !open && setPendingPackUpdate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update knowledge pack?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPackUpdate
                ? `Update “${pendingPackUpdate.packName}” from ${pendingPackUpdate.previousVersion} to ${pendingPackUpdate.version}? The currently installed version will be replaced.`
                : "The currently installed knowledge pack will be replaced."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("hub.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingPackUpdate}
              onClick={() => {
                if (!pendingPackUpdate) return;
                download.mutate(pendingPackUpdate);
                setPendingPackUpdate(null);
              }}
            >
              {t("hub.upgrade")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(pendingOverwrite)}
        onOpenChange={(open) => !open && setPendingOverwrite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Replace installed knowledge pack?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOverwrite
                ? `“${pendingOverwrite.installed.name}” ${pendingOverwrite.installed.version} is already installed. Importing “${pendingOverwrite.metadata.name}” ${pendingOverwrite.metadata.version} will replace it because Nest keeps one installed version per pack.`
                : "The installed knowledge pack will be replaced."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingOverwrite || importing}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingOverwrite) return;
                if (pendingOverwrite.kind === "zip") {
                  importLocal.mutate({
                    sourcePath: pendingOverwrite.sourcePath,
                    overwrite: true,
                  });
                } else {
                  createFromFolder.mutate({
                    sourcePath: pendingOverwrite.sourcePath,
                    metadata: pendingOverwrite.metadata,
                    overwrite: true,
                  });
                }
              }}
            >
              {importing ? "Replacing…" : "Replace pack"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function comparePackVersions(a: string, b: string): number {
  const parse = (version: string): [number, number, number] | null => {
    const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };

  const parsedA = parse(a);
  const parsedB = parse(b);
  if (!parsedA || !parsedB) {
    return a.localeCompare(b);
  }

  for (let i = 0; i < 3; i += 1) {
    if (parsedA[i] !== parsedB[i]) {
      return parsedA[i] - parsedB[i];
    }
  }

  return 0;
}
