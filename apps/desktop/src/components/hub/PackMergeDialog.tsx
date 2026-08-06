import type {
  PackMergeChoice,
  PackMergePreview,
  PackMergeResolution,
} from "@nest/shared";
import { Loader2 } from "lucide-react";
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

export function PackMergeDialog({
  open,
  preview,
  busy,
  title,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  preview: PackMergePreview | null;
  busy: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onApply: (resolutions: PackMergeResolution[]) => void;
}) {
  const [choices, setChoices] = useState<Record<string, PackMergeChoice>>({});
  useEffect(() => setChoices({}), [preview]);
  const conflicts = preview?.conflicts ?? [];
  const complete = conflicts.every((conflict) => Boolean(choices[conflict.path]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {conflicts.length === 0
              ? `${preview?.merged_file_count ?? 0} non-conflicting files can be merged safely.`
              : `${conflicts.length} file conflict${conflicts.length === 1 ? "" : "s"} require a choice. Non-conflicting changes will be merged automatically.`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {conflicts.map((conflict) => (
            <section key={conflict.path} className="rounded-md border border-border p-3">
              <p className="mb-2 truncate text-sm font-medium">{conflict.path}</p>
              <div className="mb-3 grid grid-cols-2 gap-2">
                {(["local", "approved"] as const).map((choice) => {
                  const exists =
                    choice === "local"
                      ? conflict.local_exists
                      : conflict.approved_exists;
                  const previewText =
                    choice === "local"
                      ? conflict.local_preview
                      : conflict.approved_preview;
                  return (
                    <button
                      key={choice}
                      type="button"
                      onClick={() =>
                        setChoices((current) => ({
                          ...current,
                          [conflict.path]: choice,
                        }))
                      }
                      className={`min-w-0 rounded-md border p-2 text-left ${
                        choices[conflict.path] === choice
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span className="text-xs font-medium capitalize">
                        {choice === "approved" ? "Approved Hub" : "Local"}
                        {!exists ? " (delete)" : ""}
                      </span>
                      {conflict.kind === "image" && previewText ? (
                        <img
                          src={previewText}
                          alt={`${choice} version of ${conflict.path}`}
                          className="mt-2 max-h-40 w-full object-contain"
                        />
                      ) : previewText ? (
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px]">
                          {previewText}
                        </pre>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {exists ? "Binary file" : "File is absent"}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!preview || !complete || busy}
            onClick={() =>
              onApply(
                conflicts.map((conflict) => ({
                  path: conflict.path,
                  choice: choices[conflict.path],
                })),
              )
            }
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Apply merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
