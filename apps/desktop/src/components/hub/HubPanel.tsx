import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InstalledPack,
  PackInstallConflict,
  PackMergePreview,
  PackMergeResolution,
  PackProject,
} from "@nest/shared";
import { CloudOff, FolderInput, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BrowseTab } from "@/components/hub/BrowseTab";
import { InstalledTab } from "@/components/hub/InstalledTab";
import { PackMergeDialog } from "@/components/hub/PackMergeDialog";
import {
  LocalPackImportController,
  type LocalPackImportMode,
} from "@/components/hub/LocalPackImportController";
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
import { compareSemVer } from "@/lib/semver";
import { useUiStore } from "@/stores/ui";

export function HubPanel() {
  const { t } = useI18n();
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const openAccountSettingsTab = useUiStore((s) => s.openAccountSettingsTab);
  const queryClient = useQueryClient();
  const [importMode, setImportMode] = useState<LocalPackImportMode | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const requestedHubSection = useUiStore((s) => s.hubSection);
  const [tab, setTab] = useState<"browse" | "installed">(requestedHubSection);
  useEffect(() => setTab(requestedHubSection), [requestedHubSection]);
  const [pendingPackUpdate, setPendingPackUpdate] = useState<{
    packId: string;
    packName: string;
    version: string;
    previousVersion: string;
    ownerId?: string | null;
  } | null>(null);
  const [pendingHubOverwrite, setPendingHubOverwrite] = useState<{
    packId: string;
    packName: string;
    version: string;
    previousVersion?: string;
    ownerId?: string | null;
    conflict: PackInstallConflict;
  } | null>(null);
  const [patchMerge, setPatchMerge] = useState<{
    preview: PackMergePreview;
    packName: string;
    ownerId?: string | null;
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
        p.author?.name.toLowerCase().includes(q) ||
        p.author?.id.toLowerCase().includes(q) ||
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
      packName,
      version,
      ownerId,
      replaceLocalPackId,
    }: {
      packId: string;
      packName: string;
      version: string;
      previousVersion?: string;
      ownerId?: string | null;
      replaceLocalPackId?: string;
      replacedLocalPath?: string;
    }) =>
      api.hubDownloadPack(
        packId,
        packName,
        version,
        ownerId,
        replaceLocalPackId,
      ),
    onSuccess: (_status, vars) => {
      if (vars.replacedLocalPath) clearPathsUnder(vars.replacedLocalPath);
      invalidateAfterPackChange();
      if (vars.previousVersion && vars.previousVersion !== vars.version) {
        toast.success(t("hub.packUpgraded"));
      } else {
        toast.success(t("hub.packDownloaded"));
      }
    },
    onError: (error: unknown) =>
      toast.error(t("hub.downloadFailed"), {
        description: appErrorMessage(error, t("hub.downloadFailed")),
      }),
  });

  const syncPatch = useMutation({
    mutationFn: ({
      packId,
      packName,
      version,
      ownerId,
      resolutions,
      previewToken,
    }: {
      packId: string;
      packName: string;
      version: string;
      ownerId?: string | null;
      resolutions?: PackMergeResolution[];
      previewToken?: string;
    }) =>
      api.hubSyncPackPatch(
        packId,
        packName,
        version,
        ownerId,
        resolutions,
        previewToken,
      ),
    onSuccess: () => {
      invalidateAfterPackChange();
      toast.success("Live patch synced");
    },
    onError: (error: unknown) =>
      toast.error("Could not sync live patch", {
        description: appErrorMessage(error, "Live patch sync failed"),
      }),
  });

  const requestDownload = async ({
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
    const packName = catalogById?.get(packId)?.name ?? packId;
    try {
      const conflict = await api.hubDownloadConflict(packId, packName);
      if (conflict) {
        setPendingHubOverwrite({
          packId,
          packName,
          version,
          previousVersion,
          ownerId,
          conflict,
        });
        return;
      }
    } catch (error) {
      toast.error(t("hub.downloadFailed"), {
        description: appErrorMessage(
          error,
          "Could not check for local pack conflicts",
        ),
      });
      return;
    }
    if (previousVersion && compareSemVer(version, previousVersion) > 0) {
      setPendingPackUpdate({
        packId,
        packName,
        version,
        previousVersion,
        ownerId,
      });
      return;
    }

    download.mutate({
      packId,
      packName,
      version,
      previousVersion,
      ownerId,
    });
  };

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
    exportPack.isPending ||
    syncPatch.isPending ||
    rename.isPending;
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
              onClick={() => setImportMode("choose")}
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
          <Button size="sm" variant="outline" onClick={openAccountSettingsTab}>
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
                  void requestDownload({
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
                onOpenImport={() => setImportMode("choose")}
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
                  void requestDownload({
                    packId,
                    version,
                    previousVersion,
                    ownerId,
                  })
                }
                onSyncPatch={async (packId, packName, _version, ownerId) => {
                  try {
                    const preview = await api.hubPreviewPackPatch(packId);
                    setPatchMerge({ preview, packName, ownerId });
                  } catch (error) {
                    toast.error("Could not prepare live patch", {
                      description: appErrorMessage(
                        error,
                        "Live patch preview is unavailable",
                      ),
                    });
                  }
                }}
                onRemove={(packId) => remove.mutate(packId)}
                onOpenImport={() => setImportMode("choose")}
                onBrowse={() => setTab("browse")}
                onExport={(packId, destinationPath) =>
                  exportPack.mutate({ packId, destinationPath })
                }
                authenticated={authQuery.data?.authenticated === true}
                hubUser={authQuery.data?.user ?? null}
                onSignIn={openAccountSettingsTab}
                onRename={(packId, name) => rename.mutate({ packId, name })}
                renaming={rename.isPending}
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <LocalPackImportController
        mode={importMode}
        onModeChange={setImportMode}
        installed={installedQuery.data ?? []}
      />
      <PackMergeDialog
        open={Boolean(patchMerge)}
        preview={patchMerge?.preview ?? null}
        busy={syncPatch.isPending}
        title={`Sync live patch${patchMerge ? ` for ${patchMerge.packName}` : ""}`}
        onOpenChange={(open) => !open && setPatchMerge(null)}
        onApply={(resolutions) => {
          if (!patchMerge) return;
          syncPatch.mutate(
            {
              packId: patchMerge.preview.pack_id,
              packName: patchMerge.packName,
              version: patchMerge.preview.version,
              ownerId: patchMerge.ownerId,
              resolutions,
              previewToken: patchMerge.preview.preview_token,
            },
            { onSuccess: () => setPatchMerge(null) },
          );
        }}
      />
      <AlertDialog
        open={Boolean(pendingHubOverwrite)}
        onOpenChange={(open) => !open && setPendingHubOverwrite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace local knowledge pack?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingHubOverwrite
                ? `The Hub pack “${pendingHubOverwrite.packName}” conflicts with your local pack “${pendingHubOverwrite.conflict.name}” ${pendingHubOverwrite.conflict.version}. Downloading it will replace the local files. This cannot be undone.`
                : "This download will replace a local knowledge pack."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingHubOverwrite || download.isPending}
              onClick={() => {
                if (!pendingHubOverwrite) return;
                download.mutate({
                  ...pendingHubOverwrite,
                  replaceLocalPackId: pendingHubOverwrite.conflict.pack_id,
                  replacedLocalPath: pendingHubOverwrite.conflict.local_path,
                });
                setPendingHubOverwrite(null);
              }}
            >
              Replace and download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    </div>
  );
}
