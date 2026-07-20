import type { InstalledPack, PackProject } from "@nest/shared";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowUpCircle, FolderInput, Globe, Package } from "lucide-react";
import { motion } from "motion/react";
import { RemovePackButton } from "@/components/hub/RemovePackButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n";

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
  onExport,
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
  onExport: (packId: string, destinationPath: string) => void;
}) {
  const { t } = useI18n();
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("hub.loadingPacks")}</p>;
  }

  if (installed.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        icon={<Package className="size-6" />}
        title={t("hub.registryEmpty")}
        description={t("hub.havePackFileBody")}
        footnote={
          hubOnline
            ? undefined
            : t("hub.offlineToastDescription")
        }
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            size="sm"
            onClick={onBrowse}
            disabled={!hubOnline}
            title={hubOnline ? undefined : t("hub.offline")}
          >
            <Globe className="size-4" />
            {t("hub.browseRegistry")}
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenImport}>
            <FolderInput className="size-4" />
            {t("hub.import")}
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
          t={t}
          onUpgrade={onUpgrade}
          onRemove={() => onRemove(pack.pack_id)}
          onExport={onExport}
        />
      ))}
      <Button
        variant="outline"
        onClick={onOpenImport}
        className="w-full border-dashed bg-transparent text-muted-foreground hover:text-foreground"
      >
        <FolderInput className="size-4" />
        {t("hub.importOrCreateAnother")}
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
  t,
  onUpgrade,
  onRemove,
  onExport,
}: {
  index: number;
  pack: InstalledPack;
  catalogEntry: PackProject | undefined;
  catalogAvailable: boolean;
  busy: boolean;
  removePending: boolean;
  t: ReturnType<typeof useI18n>["t"];
  onUpgrade: (packId: string, version: string, previousVersion: string) => void;
  onRemove: () => void;
  onExport: (packId: string, destinationPath: string) => void;
}) {
  const updateAvailable =
    catalogEntry != null && catalogEntry.latest_version !== pack.version;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group relative border-b border-border pb-3"
    >
      <RemovePackButton
        name={pack.name}
        disabled={busy || removePending}
        pending={removePending}
        exportLabel={t("hub.exportZip")}
        onExport={async () => {
          const destination = await save({
            title: t("hub.exportKnowledgePack"),
            defaultPath: `${pack.pack_id}-${pack.version}.zip`,
            filters: [{ name: "Knowledge pack", extensions: ["zip"] }],
          });
          if (destination) onExport(pack.pack_id, destination);
        }}
        onConfirm={onRemove}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 pr-7">
          <Package className="size-4 text-primary" />
          <h3 className="font-medium">{pack.name}</h3>
          <span className="text-xs text-muted-foreground">v{pack.version}</span>
          {catalogAvailable ? (
            catalogEntry ? (
              <Badge variant="muted">{t("hub.fromRegistry")}</Badge>
            ) : (
              <Badge variant="accent">{t("hub.importedLocally")}</Badge>
            )
          ) : (
            <Badge variant="muted">{t("hub.inVault")}</Badge>
          )}
          {updateAvailable && <Badge variant="update">{t("hub.updateAvailable")}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("hub.localFolder", { path: pack.local_path })}
        </p>
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        {updateAvailable && catalogEntry && (
          <Button
            size="sm"
            className="h-7 gap-1 bg-[#e4f4e8] px-2 text-[11px] text-[#23663a] hover:bg-[#d7eddc]"
            disabled={busy}
            onClick={() =>
              onUpgrade(pack.pack_id, catalogEntry.latest_version, pack.version)
            }
          >
            <ArrowUpCircle className="size-3.5" />
            {t("hub.upgrade")}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
