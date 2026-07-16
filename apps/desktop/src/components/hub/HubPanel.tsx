import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InstalledPack, PackProject } from "@nest/shared";
import { CloudOff, FolderInput } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BrowseTab } from "@/components/hub/BrowseTab";
import { ImportPackDialog } from "@/components/hub/ImportPackDialog";
import { InstalledTab } from "@/components/hub/InstalledTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useUiStore } from "@/stores/ui";

export function HubPanel() {
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

  const busy = download.isPending || remove.isPending;
  const installedCount = installedQuery.data?.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl">Knowledge Hub</h2>
              {hubOnline && <Badge variant="accent">Online</Badge>}
              {hubOffline && (
                <Badge variant="destructive">
                  <CloudOff className="size-3" />
                  Offline
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Install versioned packs from the configured Knowledge Hub catalog
              or import a pack zip. One active version per pack lives in your
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
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "browse" | "installed")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-4 pt-3">
          <TabsList>
            <TabsTrigger value="browse">Browse</TabsTrigger>
            <TabsTrigger value="installed">
              Installed ({installedCount})
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
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <ImportPackDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        importing={importLocal.isPending}
        onImport={(path) => importLocal.mutate(path)}
      />
    </div>
  );
}
