import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type {
  KnowledgePackMeta,
  LocalPackInspection,
} from "@nest/shared";
import { FileArchive, FolderInput, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { EMPTY_PACK_META } from "@/lib/empty-pack-meta";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  initialMode?: "choose" | "folder" | "zip";
  onOpenChange: (open: boolean) => void;
  onImportZip: (
    sourcePath: string,
    inspection: LocalPackInspection,
  ) => void;
  onCreateFromFolder: (sourcePath: string, metadata: KnowledgePackMeta) => void;
  importing?: boolean;
};

function isZipPath(path: string) {
  return path.toLowerCase().endsWith(".zip");
}

export function ImportPackDialog({
  open,
  initialMode = "choose",
  onOpenChange,
  onImportZip,
  onCreateFromFolder,
  importing = false,
}: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"choose" | "zip" | "folder">("choose");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<KnowledgePackMeta>(EMPTY_PACK_META);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zipInspection, setZipInspection] =
    useState<LocalPackInspection | null>(null);
  const [inspectingZip, setInspectingZip] = useState(false);
  const directPickerOpened = useRef(false);

  useEffect(() => {
    if (!open) {
      directPickerOpened.current = false;
      setMode("choose");
      setSelectedPath(null);
      setMetadata(EMPTY_PACK_META);
      setWarning(null);
      setError(null);
      setDragging(false);
      setZipInspection(null);
      setInspectingZip(false);
    }
  }, [open]);

  const inspectZipPath = useCallback(async (path: string) => {
    setSelectedPath(path);
    setZipInspection(null);
    setWarning(null);
    setError(null);
    setInspectingZip(true);
    try {
      const inspection = await api.hubInspectLocalPack(path);
      setZipInspection(inspection);
      if (inspection.needs_metadata) {
        setMetadata(inspection.metadata);
        setWarning(t("hub.zipMissingManifest"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInspectingZip(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open || mode !== "zip") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragging(true);
        } else if (event.payload.type === "leave") {
          setDragging(false);
        } else if (event.payload.type === "drop") {
          setDragging(false);
          const [path, ...rest] = event.payload.paths ?? [];
          if (!path || rest.length > 0 || !isZipPath(path)) {
            setError(t("hub.importFailed"));
            return;
          }
          void inspectZipPath(path);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [inspectZipPath, open, mode, t]);

  const selectZip = useCallback(
    async (): Promise<"selected" | "cancelled" | "error"> => {
      setMode("zip");
      try {
        const result = await openDialog({
          multiple: false,
          title: t("hub.selectZipTitle"),
          filters: [{ name: "Knowledge pack", extensions: ["zip"] }],
        });
        if (typeof result === "string" && result) {
          await inspectZipPath(result);
          return "selected";
        }
        return "cancelled";
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return "error";
      }
    },
    [inspectZipPath, t],
  );

  const selectFolder = useCallback(
    async (): Promise<"selected" | "cancelled" | "error"> => {
      try {
        const path = await openDialog({
          directory: true,
          multiple: false,
          title: t("hub.selectFolderTitle"),
        });
        if (typeof path !== "string" || !path) return "cancelled";
        const defaults = await api.hubReadFolderPackDefaults(path);
        setSelectedPath(path);
        setMetadata(defaults.metadata);
        setWarning(defaults.warning ?? null);
        setError(null);
        setMode("folder");
        return "selected";
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return "error";
      }
    },
    [t],
  );

  useEffect(() => {
    if (!open || initialMode === "choose" || directPickerOpened.current) {
      return;
    }
    directPickerOpened.current = true;
    const pick = initialMode === "folder" ? selectFolder : selectZip;
    void pick().then((result) => {
      if (result === "cancelled") onOpenChange(false);
    });
  }, [initialMode, onOpenChange, open, selectFolder, selectZip]);

  const update = <K extends keyof KnowledgePackMeta>(
    key: K,
    value: KnowledgePackMeta[K],
  ) => setMetadata((current) => ({ ...current, [key]: value }));

  const folderValid =
    metadata.id.trim() && metadata.name.trim() && metadata.version.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] min-w-0 max-w-[720px] overflow-hidden [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>
            {mode === "folder"
              ? t("hub.createFromFolderTitle")
              : t("hub.chooseImportModeTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode === "folder"
              ? t("hub.havePackFileBody")
              : t("hub.description")}
          </DialogDescription>
        </DialogHeader>

        {mode === "choose" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="rounded-lg border border-border p-4 text-left hover:border-primary/60"
              onClick={() => void selectFolder()}
            >
              <FolderInput className="size-6 text-primary" />
              <p className="mt-3 font-medium">
                {t("hub.createFromFolderTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("hub.havePackFileBody")}
              </p>
            </button>
            <button
              type="button"
              className="rounded-lg border border-border p-4 text-left hover:border-primary/60"
              onClick={() => setMode("zip")}
            >
              <FileArchive className="size-6 text-primary" />
              <p className="mt-3 font-medium">{t("hub.importPackZipTitle")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("hub.description")}
              </p>
            </button>
          </div>
        )}

        {mode === "zip" && (
          <div className="min-w-0 space-y-3">
            <button
              type="button"
              onClick={() => void selectZip()}
              disabled={importing}
              className={cn(
                "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/60",
              )}
            >
              <FileArchive className="size-8 text-primary" />
              <span className="font-medium">
                {dragging ? t("hub.dropZipToSelect") : t("hub.dragPackZipHere")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("hub.orClickToBrowse")}
              </span>
            </button>
            <SelectedPath path={selectedPath} />
            {inspectingZip && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t("hub.inspectingZip")}
              </p>
            )}
            {warning && zipInspection?.needs_metadata && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                {warning}
              </p>
            )}
            {zipInspection?.needs_metadata && (
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <Field label={t("hub.packId")}>
                  <Input
                    value={metadata.id}
                    onChange={(e) => update("id", e.target.value)}
                  />
                </Field>
                <Field label={t("hub.version")}>
                  <Input
                    value={metadata.version}
                    onChange={(e) => update("version", e.target.value)}
                    placeholder="0.1.0"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label={t("hub.name")}>
                    <Input
                      value={metadata.name}
                      onChange={(e) => update("name", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label={t("hub.descriptionOptional")}>
                    <Input
                      value={metadata.description}
                      onChange={(e) => update("description", e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "folder" && (
          <div className="min-w-0 space-y-3">
            <SelectedPath path={selectedPath} />
            {warning && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                {warning}
              </p>
            )}
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Field label={t("hub.packId")}>
                <Input
                  value={metadata.id}
                  onChange={(e) => update("id", e.target.value)}
                />
              </Field>
              <Field label={t("hub.version")}>
                <Input
                  value={metadata.version}
                  onChange={(e) => update("version", e.target.value)}
                  placeholder="0.1.0"
                />
              </Field>
            </div>
            <Field label={t("hub.name")}>
              <Input
                value={metadata.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </Field>
            <Field label={t("hub.descriptionOptional")}>
              <Input
                value={metadata.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </Field>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {mode !== "choose" && (
            <Button
              type="button"
              variant="ghost"
              disabled={importing}
              onClick={() => {
                setMode("choose");
                setError(null);
              }}
            >
              {t("hub.importDialogBack")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={() => onOpenChange(false)}
          >
            {t("hub.importDialogCancel")}
          </Button>
          {mode === "zip" && (
            <Button
              disabled={
                !selectedPath ||
                !zipInspection ||
                inspectingZip ||
                importing ||
                (zipInspection.needs_metadata && !folderValid)
              }
              onClick={() => {
                if (!selectedPath || !zipInspection) return;
                onImportZip(selectedPath, {
                  ...zipInspection,
                  metadata: zipInspection.needs_metadata
                    ? metadata
                    : zipInspection.metadata,
                });
              }}
            >
              {(importing || inspectingZip) && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {zipInspection?.needs_metadata
                ? t("hub.importDialogCreatePack")
                : t("hub.importDialogImportZip")}
            </Button>
          )}
          {mode === "folder" && (
            <Button
              disabled={!selectedPath || !folderValid || importing}
              onClick={() =>
                selectedPath && onCreateFromFolder(selectedPath, metadata)
              }
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {t("hub.importDialogCreatePack")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SelectedPath({ path }: { path: string | null }) {
  if (!path) return null;
  return (
    <div className="min-w-0 max-w-full rounded-md border border-border px-3 py-2">
      <p
        className="block w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-muted-foreground"
        title={path}
      >
        {path}
      </p>
    </div>
  );
}
