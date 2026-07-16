import type { InstalledPack, PackProject } from "@nest/shared";
import { ArrowUpCircle, FolderInput, Globe, Package } from "lucide-react";
import { motion } from "motion/react";
import { RemovePackButton } from "@/components/hub/RemovePackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function InstalledTab({
  installed,
  isLoading,
  hubOnline,
  catalogById,
  busy,
  removePending,
  onUpgrade,
  onRemove,
  onOpenImport,
  onBrowse,
}: {
  installed: InstalledPack[];
  isLoading: boolean;
  hubOnline: boolean;
  catalogById: Map<string, PackProject> | null;
  busy: boolean;
  removePending: boolean;
  onUpgrade: (packId: string, version: string, previousVersion: string) => void;
  onRemove: (packId: string) => void;
  onOpenImport: () => void;
  onBrowse: () => void;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading packs…</p>;
  }

  if (installed.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center">
        <Package className="mx-auto size-6 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">
          No packs in your vault yet
        </h3>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Download packs from the registry or import a knowledge pack zip from
          your computer.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            size="sm"
            onClick={onBrowse}
            disabled={!hubOnline}
            title={hubOnline ? undefined : "Knowledge Hub is offline"}
          >
            <Globe className="size-4" />
            Browse registry
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenImport}>
            <FolderInput className="size-4" />
            Import local .zip
          </Button>
        </div>
        {!hubOnline && (
          <p className="text-xs text-muted-foreground">
            The registry is unavailable while the Hub is offline.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {installed.map((pack, i) => (
        <InstalledPackRow
          key={pack.pack_id}
          index={i}
          pack={pack}
          catalogEntry={catalogById?.get(pack.pack_id)}
          catalogAvailable={catalogById != null}
          busy={busy}
          removePending={removePending}
          onUpgrade={onUpgrade}
          onRemove={() => onRemove(pack.pack_id)}
        />
      ))}
      <button
        type="button"
        onClick={onOpenImport}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FolderInput className="size-4" />
        Import another pack (.zip)…
      </button>
    </div>
  );
}

function InstalledPackRow({
  index,
  pack,
  catalogEntry,
  catalogAvailable,
  busy,
  removePending,
  onUpgrade,
  onRemove,
}: {
  index: number;
  pack: InstalledPack;
  catalogEntry: PackProject | undefined;
  catalogAvailable: boolean;
  busy: boolean;
  removePending: boolean;
  onUpgrade: (packId: string, version: string, previousVersion: string) => void;
  onRemove: () => void;
}) {
  const updateAvailable =
    catalogEntry != null && catalogEntry.latest_version !== pack.version;

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
          <h3 className="font-medium">{pack.name}</h3>
          <span className="text-xs text-muted-foreground">v{pack.version}</span>
          {catalogAvailable ? (
            catalogEntry ? (
              <Badge variant="muted">From registry</Badge>
            ) : (
              <Badge variant="accent">Imported locally</Badge>
            )
          ) : (
            <Badge variant="muted">In vault</Badge>
          )}
          {updateAvailable && <Badge variant="accent">Update available</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Local folder · {pack.local_path}
        </p>
      </div>
      <div className="relative flex shrink-0 items-center gap-2">
        {updateAvailable && catalogEntry && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              onUpgrade(pack.pack_id, catalogEntry.latest_version, pack.version)
            }
          >
            <ArrowUpCircle className="size-4" />
            Upgrade
          </Button>
        )}
        <RemovePackButton
          name={pack.name}
          disabled={busy || removePending}
          pending={removePending}
          onConfirm={onRemove}
        />
      </div>
    </motion.div>
  );
}
