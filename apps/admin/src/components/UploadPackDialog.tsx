import { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileArchive, Loader2 } from "lucide-react";
import { Button, Dialog, ErrorBox } from "./ui";
import { cn } from "../lib/cn";

export function UploadPackDialog({
  open,
  onOpenChange,
  busy,
  error,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: unknown;
  onUpload: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset(next: boolean) {
    if (!next) setFile(null);
    onOpenChange(next);
  }

  function acceptFile(candidate: File | undefined) {
    if (!candidate || !candidate.name.toLowerCase().endsWith(".zip")) return;
    setFile(candidate);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={reset}
      title="Upload pack"
      description="Upload a pack .zip to submit it for review. It lands on the Reviews page as pending — approve it there to publish. If the pack ID is new, approval creates a new catalog entry; if it matches an existing pack, approval adds a new version."
    >
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          acceptFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition disabled:cursor-not-allowed disabled:opacity-50",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50",
        )}
      >
        <FileArchive className="size-8 text-primary" />
        <span className="font-medium text-foreground">
          {dragging ? "Drop .zip to select" : "Drag a pack .zip here"}
        </span>
        <span className="text-xs text-muted-foreground">or click to browse</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        className="sr-only"
        onChange={(e) => acceptFile(e.target.files?.[0])}
      />
      {file && (
        <div className="mt-3 truncate rounded-md border border-border px-3 py-2 font-mono text-xs text-muted-foreground">
          {file.name}
        </div>
      )}
      {error != null && (
        <div className="mt-3">
          <ErrorBox error={error} />
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <DialogPrimitive.Close asChild>
          <Button variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogPrimitive.Close>
        <Button
          disabled={!file || busy}
          onClick={() => file && onUpload(file)}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Uploading…" : "Upload pack"}
        </Button>
      </div>
    </Dialog>
  );
}
