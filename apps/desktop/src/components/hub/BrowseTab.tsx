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
import { Input } from "@/components/ui/input";

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
      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center">
          <CloudOff className="mx-auto size-6 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">
            Connect to the Knowledge Hub
          </h3>
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
          <p className="text-xs text-muted-foreground">
            Packs already in your vault stay available in the Installed tab.
          </p>
        </section>
      </div>
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
        <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-5 text-center">
          <p className="text-sm text-muted-foreground">
            The registry has no packs available yet.
          </p>
          <Button size="sm" variant="outline" onClick={onOpenImport}>
            <FolderInput className="size-4" />
            Import local .zip
          </Button>
        </div>
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
            <Badge variant="muted">installed {installed.version}</Badge>
          )}
          {updateAvailable && <Badge variant="accent">Update available</Badge>}
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
            <RemovePackButton
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
              <RemovePackButton
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
