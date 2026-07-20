import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstalledPack, KnowledgePackMeta, PackProject } from "@nest/shared";
import { CloudOff, FolderInput } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BrowseTab } from "@/components/hub/BrowseTab";
import { ImportPackDialog } from "@/components/hub/ImportPackDialog";
import { InstalledTab } from "@/components/hub/InstalledTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useUiStore } from "@/stores/ui";

export function HubPanel() {
  const { t } = useI18n();
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [tab, setTab] = useState<"browse" | "installed">("browse");

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
      toast.warning(t("hub.offlineToastTitle"), {
        description: hubStatusQuery.data.message || t("hub.offlineToastDescription"),
      });
    }
  }, [hubStatusQuery.data, t]);

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
        toast.success(t("hub.packUpgraded"), {
          description: t("hub.upgradeDescription", {
            packId: vars.packId,
            previousVersion: vars.previousVersion,
            version: vars.version,
            count: status.indexed_files,
          }),
        });
      } else {
        toast.success(t("hub.packDownloaded"), {
          description: t("hub.downloadDescription", {
            packId: vars.packId,
            version: vars.version,
            count: status.indexed_files,
          }),
        });
      }
    },
    onError: (e: Error) => toast.error(t("hub.downloadFailed"), { description: e.message }),
  });

  const importLocal = useMutation({
    mutationFn: (sourcePath: string) => api.hubImportLocalPack(sourcePath),
    onSuccess: (status) => {
      setImportOpen(false);
      invalidateAfterPackChange();
      toast.success(t("hub.packImported"), {
        description: t("hub.indexedFiles", { count: status.indexed_files }),
      });
    },
    onError: (e: Error) =>
      toast.error(t("hub.importFailed"), {
        description: e.message || String(e),
      }),
  });

  const createFromFolder = useMutation({
    mutationFn: ({ sourcePath, metadata }: { sourcePath: string; metadata: KnowledgePackMeta }) =>
      api.hubCreatePackFromFolder(sourcePath, metadata),
    onSuccess: (status) => {
      setImportOpen(false);
      invalidateAfterPackChange();
      toast.success(t("hub.packCreated"), {
        description: t("hub.indexedFiles", { count: status.indexed_files }),
      });
    },
    onError: (e: Error) =>
      toast.error(t("hub.createFailed"), { description: e.message || String(e) }),
  });

  const exportPack = useMutation({
    mutationFn: ({ packId, destinationPath }: { packId: string; destinationPath: string }) =>
      api.hubExportPack(packId, destinationPath),
    onSuccess: () => toast.success(t("hub.packExported")),
    onError: (e: Error) =>
      toast.error(t("hub.exportFailed"), { description: e.message || String(e) }),
  });

  const remove = useMutation({
    mutationFn: (packId: string) => api.hubRemovePack(packId),
    onSuccess: (_status, packId) => {
      const localPath =
        installedQuery.data?.find((p) => p.pack_id === packId)?.local_path ??
        packId;
      clearPathsUnder(localPath);
      invalidateAfterPackChange();
      toast.success(t("hub.packRemoved"), {
        description: t("hub.removedDescription", { packId }),
      });
    },
    onError: (e: Error) =>
      toast.error(t("hub.removeFailed"), {
        description: e.message || String(e),
      }),
  });

  const busy = download.isPending || remove.isPending || createFromFolder.isPending || importLocal.isPending || exportPack.isPending;
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
          >
            <FolderInput className="size-4" />
            {t("hub.import")}
          </Button>
        }
      />

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
                removePending={remove.isPending}
                onInstall={(packId, version, previousVersion) =>
                  download.mutate({ packId, version, previousVersion })
                }
                onRemove={(packId) => remove.mutate(packId)}
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
                removePending={remove.isPending}
                onUpgrade={(packId, version, previousVersion) =>
                  download.mutate({ packId, version, previousVersion })
                }
                onRemove={(packId) => remove.mutate(packId)}
                onOpenImport={() => setImportOpen(true)}
                onBrowse={() => setTab("browse")}
                onExport={(packId, destinationPath) => exportPack.mutate({ packId, destinationPath })}
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <ImportPackDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importing={importLocal.isPending || createFromFolder.isPending}
        onImportZip={(path) => importLocal.mutate(path)}
        onCreateFromFolder={(sourcePath, metadata) => createFromFolder.mutate({ sourcePath, metadata })}
      />
    </div>
  );
}
