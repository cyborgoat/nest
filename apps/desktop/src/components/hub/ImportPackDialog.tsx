import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileArchive, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (sourcePath: string) => void;
  importing?: boolean;
};

function isZipPath(p: string) {
  return p.toLowerCase().endsWith(".zip");
}

export function ImportPackDialog({
  open,
  onOpenChange,
  onImport,
  importing = false,
}: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedPath(null);
      setDragging(false);
      setDropError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragging(true);
          return;
        }
        if (event.payload.type === "leave") {
          setDragging(false);
          return;
        }
        if (event.payload.type === "drop") {
          setDragging(false);
          const paths = event.payload.paths ?? [];
          if (paths.length === 0) {
            setDropError("No file was dropped.");
            return;
          }
          if (paths.length > 1) {
            setDropError("Drop a single .zip pack (not multiple items).");
            return;
          }
          const path = paths[0];
          if (!isZipPath(path)) {
            setDropError("Knowledge packs must be a .zip file.");
            return;
          }
          setDropError(null);
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
  }, [open]);

  const pickZip = async () => {
    try {
      const result = await openFileDialog({
        multiple: false,
        title: "Select a knowledge pack zip",
        filters: [{ name: "Knowledge pack", extensions: ["zip"] }],
      });
      if (typeof result === "string" && result) {
        if (!isZipPath(result)) {
          setDropError("Knowledge packs must be a .zip file.");
          return;
        }
        setDropError(null);
        setSelectedPath(result);
      }
    } catch (e) {
      setDropError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import local pack</DialogTitle>
          <DialogDescription>
            Add a Markdown knowledge pack zip from your computer. Nest extracts
            it into your vault and indexes it for chat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border border-border bg-muted/40 px-3 py-3">
            <p className="font-medium text-foreground">Import guide</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>
                Import a <span className="text-foreground">.zip</span> file —
                not a loose folder.
              </li>
              <li>
                The zip must include a required{" "}
                <span className="font-mono text-xs">pack.json</span> at the pack
                root (same layout as Hub downloads / fixtures).
              </li>
              <li>
                <span className="font-mono text-xs">pack.json</span> must set{" "}
                <span className="font-mono text-xs">id</span>,{" "}
                <span className="font-mono text-xs">name</span>,{" "}
                <span className="font-mono text-xs">description</span>,{" "}
                <span className="font-mono text-xs">version</span>, and{" "}
                <span className="font-mono text-xs">path</span> (single folder
                name).
              </li>
              <li>
                Include at least one{" "}
                <span className="font-mono text-xs">.md</span> file. Nested
                subfolders are fine.
              </li>
              <li>
                Re-importing the same{" "}
                <span className="font-mono text-xs">path</span> replaces the
                previous copy. Packs are stored read-only in the vault.
              </li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Example zip layout:{" "}
              <span className="font-mono">my-topic/pack.json</span>,{" "}
              <span className="font-mono">my-topic/README.md</span>,{" "}
              <span className="font-mono">my-topic/guides/intro.md</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => void pickZip()}
            disabled={importing}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors",
              dragging
                ? "border-primary bg-primary/5 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
            )}
          >
            <FileArchive className="size-8 text-primary" />
            <span className="text-sm font-medium text-foreground">
              {dragging ? "Drop zip to select" : "Drag & drop a pack .zip"}
            </span>
            <span className="text-xs">or click to browse</span>
          </button>

          {selectedPath && (
            <div className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
              <FileArchive className="mt-0.5 size-4 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">
                  Selected zip
                </p>
                <p className="truncate font-mono text-xs" title={selectedPath}>
                  {selectedPath}
                </p>
              </div>
            </div>
          )}

          {dropError && (
            <p className="text-sm text-destructive">{dropError}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedPath || importing}
            onClick={() => {
              if (selectedPath) onImport(selectedPath);
            }}
          >
            {importing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Importing…
              </>
            ) : (
              "Import pack"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
