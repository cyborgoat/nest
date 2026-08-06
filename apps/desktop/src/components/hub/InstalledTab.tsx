import type { HubUser, InstalledPack, PackProject } from "@nest/shared";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpCircle,
  FolderInput,
  Globe,
  Package,
  RefreshCw,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { PackPublishDialogController } from "@/components/hub/PackPublishDialogController";
import { RemovePackButton } from "@/components/hub/RemovePackButton";
import { RenamePackDialog } from "@/components/hub/RenamePackDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { canEditPack, canRenamePack } from "@/lib/pack-permissions";
import { pendingPublishVersionLabel } from "@/lib/publish-request-labels";
import { cn } from "@/lib/utils";

export function InstalledTab({
  installed,
  isLoading,
  hubOnline,
  catalogById,
  busy,
  downloadPendingId,
  removePendingId,
  onUpgrade,
  onSyncPatch,
  onRemove,
  onOpenImport,
  onBrowse,
  onExport,
  authenticated,
  hubUser,
  onSignIn,
  onRename,
  renaming,
}: {
  installed: InstalledPack[];
  isLoading: boolean;
  hubOnline: boolean;
  catalogById: Map<string, PackProject> | null;
  busy: boolean;
  downloadPendingId?: string;
  removePendingId?: string;
  onUpgrade: (
    packId: string,
    version: string,
    previousVersion: string,
    ownerId?: string | null,
  ) => void;
  onSyncPatch: (
    packId: string,
    packName: string,
    version: string,
    ownerId?: string | null,
  ) => void;
  onRemove: (packId: string) => void;
  onOpenImport: () => void;
  onBrowse: () => void;
  onExport: (packId: string, destinationPath: string) => void;
  authenticated: boolean;
  hubUser: HubUser | null;
  onSignIn: () => void;
  onRename: (packId: string, name: string) => void;
  renaming?: boolean;
}) {
  const { t } = useI18n();
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner />
        {t("hub.loadingPacks")}
      </div>
    );
  }

  if (installed.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        icon={<Package className="size-6" />}
        title={t("hub.registryEmpty")}
        description={t("hub.havePackFileBody")}
        footnote={hubOnline ? undefined : t("hub.offlineToastDescription")}
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
          busy={busy}
          downloading={downloadPendingId === pack.pack_id}
          removePending={removePendingId === pack.pack_id}
          t={t}
          onUpgrade={onUpgrade}
          onSyncPatch={onSyncPatch}
          onRemove={() => onRemove(pack.pack_id)}
          onExport={onExport}
          authenticated={authenticated}
          canEdit={canEditPack(pack, hubUser)}
          onSignIn={onSignIn}
          onRename={onRename}
          renaming={renaming}
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
  busy,
  downloading,
  removePending,
  t,
  onUpgrade,
  onSyncPatch,
  onRemove,
  onExport,
  authenticated,
  canEdit,
  onSignIn,
  onRename,
  renaming,
}: {
  index: number;
  pack: InstalledPack;
  catalogEntry: PackProject | undefined;
  busy: boolean;
  downloading: boolean;
  removePending: boolean;
  t: ReturnType<typeof useI18n>["t"];
  onUpgrade: (
    packId: string,
    version: string,
    previousVersion: string,
    ownerId?: string | null,
  ) => void;
  onSyncPatch: (
    packId: string,
    packName: string,
    version: string,
    ownerId?: string | null,
  ) => void;
  onRemove: () => void;
  onExport: (packId: string, destinationPath: string) => void;
  authenticated: boolean;
  canEdit: boolean;
  onSignIn: () => void;
  onRename: (packId: string, name: string) => void;
  renaming?: boolean;
}) {
  const updateAvailable =
    catalogEntry != null &&
    catalogEntry.latest_version !== pack.version &&
    !pack.pending_version;
  const currentRelease = catalogEntry?.releases?.find(
    (release) => release.version === pack.version,
  );
  const patchAvailable =
    currentRelease != null &&
    !currentRelease.yanked &&
    currentRelease.patch_revision > pack.patch_revision;
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

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
        onPublish={
          canEdit
            ? () => (authenticated ? setPublishDialogOpen(true) : onSignIn())
            : undefined
        }
        publishLabel={
          pack.publish_review_status === "approved_awaiting_merge"
            ? `${pendingPublishVersionLabel(pack)} ready to merge`
            : pack.pending_version
              ? `${pendingPublishVersionLabel(pack)} awaiting review`
              : authenticated
                ? "Publish"
                : "Sign in to publish"
        }
        publishDisabled={Boolean(pack.pending_version)}
        onRename={
          canRenamePack(pack) ? () => setRenameDialogOpen(true) : undefined
        }
      />
      <RenamePackDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        currentName={pack.name}
        renaming={renaming}
        onRename={(name) => {
          onRename(pack.pack_id, name);
          setRenameDialogOpen(false);
        }}
      />
      <PackPublishDialogController
        pack={pack}
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 pr-7">
          <Package
            className={cn(
              "size-4",
              pack.origin === "registry" ? "text-info" : "text-primary",
            )}
          />
          <h3 className="font-medium">{pack.name}</h3>
          <span className="text-xs text-muted-foreground">v{pack.version}</span>
          <span className="text-xs text-muted-foreground">
            Patch {pack.patch_revision}
          </span>
          {pack.publish_review_status === "pending" && pack.pending_version && (
            <Badge variant="accent">
              {pendingPublishVersionLabel(pack)} under review
              {pack.pending_submitter_name
                ? ` by ${pack.pending_submitter_name}`
                : ""}
            </Badge>
          )}
          {pack.publish_review_status === "approved_awaiting_merge" &&
            pack.pending_version && (
              <Badge variant="update">
                {pendingPublishVersionLabel(pack)} ready to merge
              </Badge>
            )}
          {pack.origin === "local" && (
            <Badge variant="accent">{t("hub.importedLocally")}</Badge>
          )}
          {pack.origin === "registry" && (
            <Badge variant="muted">{t("hub.fromRegistry")}</Badge>
          )}
          {pack.origin === "bundled" && (
            <Badge variant="muted">{t("hub.bundledPack")}</Badge>
          )}
          {pack.origin === "unknown" && (
            <Badge variant="muted">{t("hub.unknownOrigin")}</Badge>
          )}
          {updateAvailable && (
            <Badge variant="update">{t("hub.updateAvailable")}</Badge>
          )}
          {patchAvailable && <Badge variant="update">Patch available</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("hub.localFolder", { path: pack.local_path })}
        </p>
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        {patchAvailable && catalogEntry && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={busy}
            onClick={() =>
              onSyncPatch(
                pack.pack_id,
                pack.name,
                pack.version,
                catalogEntry.owner_id,
              )
            }
          >
            <RefreshCw className="size-3.5" />
            Sync patch
          </Button>
        )}
        {updateAvailable && catalogEntry && (
          <Button
            size="sm"
            className="h-7 gap-1 bg-success-muted px-2 text-[11px] text-success hover:bg-success-muted-hover"
            disabled={busy}
            onClick={() =>
              onUpgrade(
                pack.pack_id,
                catalogEntry.latest_version,
                pack.version,
                catalogEntry.owner_id,
              )
            }
          >
            {downloading ? (
              <Spinner data-icon="inline-start" className="size-3.5" />
            ) : (
              <ArrowUpCircle className="size-3.5" />
            )}
            {downloading ? t("hub.upgrading") : t("hub.upgrade")}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
