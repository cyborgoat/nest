import type { InstalledPack, PackProject } from "@nest/shared";
import {
  ArrowUpCircle,
  Check,
  CloudDownload,
  CloudOff,
  FolderInput,
  Globe,
  Package,
  Search,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { RemovePackButton } from "@/components/hub/RemovePackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BrowseTab({
  hubOffline,
  packs,
  filteredPacks,
  packsLoading,
  packsError,
  search,
  onSearchChange,
  installedById,
  busy,
  removePending,
  onInstall,
  onRemove,
  onOpenImport,
}: {
  hubOffline: boolean;
  packs: PackProject[] | undefined;
  filteredPacks: PackProject[];
  packsLoading: boolean;
  packsError: Error | null;
  search: string;
  onSearchChange: (q: string) => void;
  installedById: Map<string, InstalledPack>;
  busy: boolean;
  removePending: boolean;
  onInstall: (packId: string, version: string, previousVersion?: string) => void;
  onRemove: (packId: string) => void;
  onOpenImport: () => void;
}) {
  if (hubOffline) {
    return (
      <EmptyState
        variant="dashed"
        icon={<CloudOff className="size-6" />}
        title="Connect to the Knowledge Hub"
        footnote="Packs already in your vault stay available in the Installed tab."
      >
        <div className="mx-auto grid max-w-lg gap-3 text-left sm:grid-cols-2">
          <div className="space-y-1.5 rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Globe className="size-4 text-primary" />
              Browse the registry
            </div>
            <p className="text-sm text-muted-foreground">
              Start the Hub service and check the Hub URL in Settings to
              browse and download packs.
            </p>
          </div>
          <div className="space-y-1.5 rounded-md border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <FolderInput className="size-4 text-accent" />
              Have a pack file?
            </div>
            <p className="text-sm text-muted-foreground">
              No connection needed — import a knowledge pack zip directly.
            </p>
            <Button size="sm" variant="outline" onClick={onOpenImport}>
              <FolderInput className="size-4" />
              Import local .zip
            </Button>
          </div>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search packs…"
          className="h-9 pl-8"
        />
      </div>
      {packsLoading && (
        <p className="text-sm text-muted-foreground">Loading packs…</p>
      )}
      {packsError && (
        <p className="text-sm text-destructive">{packsError.message}</p>
      )}
      {filteredPacks.map((pack, i) => (
        <PackRow
          key={pack.id}
          index={i}
          project={pack}
          installed={installedById.get(pack.id)}
          busy={busy}
          onInstall={(version) =>
            onInstall(pack.id, version, installedById.get(pack.id)?.version)
          }
          onRemove={() => onRemove(pack.id)}
          removePending={removePending}
        />
      ))}
      {packs && packs.length > 0 && filteredPacks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No packs match “{search}”.
        </p>
      )}
      {packs?.length === 0 && (
        <EmptyState
          variant="dashed"
          icon={<Package className="size-6" />}
          title="The registry has no packs available yet"
        >
          <Button size="sm" variant="outline" onClick={onOpenImport}>
            <FolderInput className="size-4" />
            Import local .zip
          </Button>
        </EmptyState>
      )}
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
      className="relative border-b border-border pb-3"
    >
      {isInstalled && (
        <RemovePackButton
          name={project.name}
          disabled={busy || removePending}
          pending={removePending}
          onConfirm={onRemove}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 pr-7">
          <Package className="size-4 shrink-0 text-primary" />
          <h3 className="min-w-0 truncate font-medium">{project.name}</h3>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            Version
          </span>
          <Select
            value={selectedVersion}
            onValueChange={setSelectedVersion}
            disabled={busy}
          >
            <SelectTrigger
              aria-label={`Version for ${project.name}`}
              className="h-5 w-16 shrink-0 gap-0.5 px-1 text-[11px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-0 text-[11px]">
              {versions.map((v) => (
                <SelectItem
                  key={v}
                  value={v}
                  className="py-0.5 pl-1.5 pr-5 text-[11px]"
                >
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {project.description}
        </p>
        {isInstalled && (
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="muted">Installed {installed.version}</Badge>
            {updateAvailable && <Badge variant="accent">Update available</Badge>}
          </div>
        )}
        <div className="mt-2 flex justify-end">
          <div className="flex shrink-0 items-center gap-1.5">
            {selectedIsInstalled ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled
                >
                  <Check className="size-3.5" />
                  Installed
                </Button>
                {updateAvailable && (
                  <Button
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    disabled={busy}
                    onClick={() => onInstall(project.latest_version)}
                  >
                    <ArrowUpCircle className="size-3.5" />
                    Upgrade
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={busy}
                  onClick={() => onInstall(selectedVersion)}
                >
                  {isInstalled ? (
                    <>
                      <ArrowUpCircle className="size-3.5" />
                      Install {selectedVersion}
                    </>
                  ) : (
                    <>
                      <CloudDownload className="size-3.5" />
                      Download
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
