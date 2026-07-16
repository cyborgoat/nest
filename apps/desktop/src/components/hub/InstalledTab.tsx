import type { InstalledPack, PackProject } from "@nest/shared";
import { ArrowUpCircle, FolderInput, Globe, Package } from "lucide-react";
import { motion } from "motion/react";
import { RemovePackButton } from "@/components/hub/RemovePackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

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
      <EmptyState
        variant="dashed"
        icon={<Package className="size-6" />}
        title="No packs in your vault yet"
        description="Download packs from the registry or import a knowledge pack zip from your computer."
        footnote={
          hubOnline
            ? undefined
            : "The registry is unavailable while the Hub is offline."
        }
      >
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
      </EmptyState>
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
      <Button
        variant="outline"
        onClick={onOpenImport}
        className="w-full border-dashed bg-transparent text-muted-foreground hover:text-foreground"
      >
        <FolderInput className="size-4" />
        Import another pack (.zip)…
      </Button>
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
      className="relative border-b border-border pb-3"
    >
      <RemovePackButton
        name={pack.name}
        disabled={busy || removePending}
        pending={removePending}
        onConfirm={onRemove}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 pr-7">
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
      <div className="mt-2 flex justify-end gap-1.5">
        {updateAvailable && catalogEntry && (
          <Button
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy}
            onClick={() =>
              onUpgrade(pack.pack_id, catalogEntry.latest_version, pack.version)
            }
          >
            <ArrowUpCircle className="size-3.5" />
            Upgrade
          </Button>
        )}
      </div>
    </motion.div>
  );
}
