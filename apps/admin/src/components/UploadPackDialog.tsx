import { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileArchive, Loader2 } from "lucide-react";
import type { KnowledgePackMeta, LocalPackInspection } from "@nest/shared";
import { Button, Dialog, ErrorBox, Field } from "./ui";
import { cn } from "../lib/cn";

const EMPTY_METADATA: KnowledgePackMeta = {
  id: "",
  name: "",
  description: "",
  version: "",
};

export function UploadPackDialog({
  open,
  onOpenChange,
  busy,
  error,
  onInspect,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: unknown;
  onInspect: (file: File) => Promise<LocalPackInspection>;
  onUpload: (
    file: File,
    commitMessage: string,
    metadata?: KnowledgePackMeta,
  ) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<LocalPackInspection | null>(
    null,
  );
  const [inspectError, setInspectError] = useState<unknown>(null);
  const [metadata, setMetadata] = useState<KnowledgePackMeta>(EMPTY_METADATA);
  const [commitMessage, setCommitMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function reset(next: boolean) {
    if (!next) {
      setFile(null);
      setInspection(null);
      setInspectError(null);
      setMetadata(EMPTY_METADATA);
      setCommitMessage("");
    }
    onOpenChange(next);
  }

  function acceptFile(candidate: File | undefined) {
    if (!candidate || !candidate.name.toLowerCase().endsWith(".zip")) return;
    setFile(candidate);
    setInspection(null);
    setInspectError(null);
    setInspecting(true);
    onInspect(candidate)
      .then((result) => {
        setInspection(result);
        if (result.needs_metadata) setMetadata(result.metadata);
      })
      .catch((e: unknown) => setInspectError(e))
      .finally(() => setInspecting(false));
  }

  const needsMetadata = inspection?.needs_metadata ?? false;
  const canUpload =
    !!file &&
    !busy &&
    !inspecting &&
    !inspectError &&
    !!commitMessage.trim() &&
    (!needsMetadata ||
      (metadata.id.trim() && metadata.name.trim() && metadata.version.trim()));

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
        <div className="mt-3 flex items-center gap-2 truncate rounded-md border border-border px-3 py-2 font-mono text-xs text-muted-foreground">
          {inspecting && (
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
          )}
          <span className="truncate">{file.name}</span>
        </div>
      )}
      {needsMetadata && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This zip has no pack.json — review the details below before
            uploading.
          </p>
          <Field label="Pack ID">
            <input
              className="input"
              value={metadata.id}
              onChange={(e) =>
                setMetadata((m) => ({ ...m, id: e.target.value }))
              }
            />
          </Field>
          <Field label="Name">
            <input
              className="input"
              value={metadata.name}
              onChange={(e) =>
                setMetadata((m) => ({ ...m, name: e.target.value }))
              }
            />
          </Field>
          <Field label="Description">
            <input
              className="input"
              value={metadata.description}
              onChange={(e) =>
                setMetadata((m) => ({ ...m, description: e.target.value }))
              }
            />
          </Field>
          <Field label="Version">
            <input
              className="input"
              value={metadata.version}
              onChange={(e) =>
                setMetadata((m) => ({ ...m, version: e.target.value }))
              }
            />
          </Field>
        </div>
      )}
      <div className="mt-3">
        <Field label="Publish commit message">
          <textarea
            className="input min-h-20 resize-y"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Summarize what changed in this publish"
            maxLength={500}
          />
        </Field>
      </div>
      {inspectError != null && (
        <div className="mt-3">
          <ErrorBox error={inspectError} />
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
          disabled={!canUpload}
          onClick={() =>
            file &&
            onUpload(
              file,
              commitMessage.trim(),
              needsMetadata ? metadata : undefined,
            )
          }
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Uploading…" : "Upload pack"}
        </Button>
      </div>
    </Dialog>
  );
}
