import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { KnowledgePackMeta } from "@nest/shared";
import { FileArchive, FolderInput, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportZip: (sourcePath: string) => void;
  onCreateFromFolder: (sourcePath: string, metadata: KnowledgePackMeta) => void;
  importing?: boolean;
};

const EMPTY: KnowledgePackMeta = {
  id: "",
  name: "",
  description: "",
  version: "1.0.0",
};

function isZipPath(path: string) {
  return path.toLowerCase().endsWith(".zip");
}

export function ImportPackDialog({
  open,
  onOpenChange,
  onImportZip,
  onCreateFromFolder,
  importing = false,
}: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"choose" | "zip" | "folder">("choose");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<KnowledgePackMeta>(EMPTY);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) {
      setMode("choose");
      setSelectedPath(null);
      setMetadata(EMPTY);
      setWarning(null);
      setError(null);
      setDragging(false);
    }
  }, [open]);

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
          setError(null);
          setSelectedPath(path);
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
  }, [open, mode]);

  const selectZip = async () => {
    const result = await openDialog({
      multiple: false,
      title: t("hub.selectZipTitle"),
      filters: [{ name: "Knowledge pack", extensions: ["zip"] }],
    });
    if (typeof result === "string" && result) {
      setSelectedPath(result);
      setError(null);
    }
  };

  const selectFolder = async () => {
    try {
      const path = await openDialog({
        directory: true,
        multiple: false,
        title: t("hub.selectFolderTitle"),
      });
      if (typeof path !== "string" || !path) return;
      const defaults = await api.hubReadFolderPackDefaults(path);
      setSelectedPath(path);
      setMetadata(defaults.metadata);
      setWarning(defaults.warning ?? null);
      setError(null);
      setMode("folder");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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
                  placeholder="1.0.0"
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
              disabled={!selectedPath || importing}
              onClick={() => selectedPath && onImportZip(selectedPath)}
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {t("hub.importDialogImportZip")}
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

