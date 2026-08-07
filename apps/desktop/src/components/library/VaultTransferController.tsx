import type {
  VaultConflictPolicy,
  VaultTransferOperation,
  VaultTransferPreview,
  VaultTransferResult,
} from "@nest/shared";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export type VaultTransferRequest = {
  destDir: string;
  sourcePaths: string[];
  operation: VaultTransferOperation;
  onComplete: (result: VaultTransferResult) => void;
};

type PendingTransfer = {
  request: VaultTransferRequest;
  preview: VaultTransferPreview;
};

export function useVaultTransfer() {
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const [applying, setApplying] = useState(false);

  const finish = useCallback(
    async (request: VaultTransferRequest, policy: VaultConflictPolicy) => {
      setApplying(true);
      try {
        const result = await api.vaultApplyTransfer(
          request.destDir,
          request.sourcePaths,
          request.operation,
          policy,
        );
        setPending(null);
        request.onComplete(result);
        const count = result.written_files.length + result.created_folders.length;
        if (count > 0) {
          toast.success(
            request.operation === "move"
              ? `${count} item${count === 1 ? "" : "s"} moved`
              : `${count} item${count === 1 ? "" : "s"} imported`,
            result.skipped.length
              ? { description: `Skipped: ${result.skipped.join("; ")}` }
              : undefined,
          );
        } else if (result.skipped.length) {
          toast.message("Nothing changed", {
            description: result.skipped.join("; "),
          });
        }
      } catch (error) {
        if (policy === "error") {
          try {
            const preview = await api.vaultPreviewTransfer(
              request.destDir,
              request.sourcePaths,
              request.operation,
            );
            if (preview.conflicts.length) {
              setPending({ request, preview });
              return;
            }
          } catch {
            // Preserve the original apply error below.
          }
        }
        toast.error(
          request.operation === "move"
            ? "Could not move items"
            : "Could not import items",
          { description: error instanceof Error ? error.message : String(error) },
        );
      } finally {
        setApplying(false);
      }
    },
    [],
  );

  const startTransfer = useCallback(
    async (request: VaultTransferRequest) => {
      try {
        const preview = await api.vaultPreviewTransfer(
          request.destDir,
          request.sourcePaths,
          request.operation,
        );
        if (preview.eligible_count === 0) {
          toast.error("Nothing to transfer", {
            description: preview.skipped.join("; ") || "No supported items were selected.",
          });
          return;
        }
        if (preview.conflicts.length) {
          setPending({ request, preview });
          return;
        }
        await finish(request, "error");
      } catch (error) {
        toast.error(
          request.operation === "move"
            ? "Cannot move items"
            : "Cannot import items",
          { description: error instanceof Error ? error.message : String(error) },
        );
      }
    },
    [finish],
  );

  const conflictDialog = (
    <AlertDialog
      open={pending != null}
      onOpenChange={(open) => !open && !applying && setPending(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Items already exist</AlertDialogTitle>
          <AlertDialogDescription>
            {pending
              ? `${pending.preview.conflicts.length} conflict${pending.preview.conflicts.length === 1 ? "" : "s"} found in “${pending.request.destDir}”. Replace the existing items, skip every conflict, or cancel the entire drop.`
              : "Choose how to resolve the conflicts."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pending ? (
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-xs">
            {pending.preview.conflicts.slice(0, 8).map((conflict) => (
              <div key={`${conflict.source_path}:${conflict.destination_path}`}>
                <span className="font-medium">{conflict.destination_path}</span>
                {conflict.kind === "type_mismatch" ? (
                  <span className="text-muted-foreground"> · different item type</span>
                ) : null}
              </div>
            ))}
            {pending.preview.conflicts.length > 8 ? (
              <div className="text-muted-foreground">
                +{pending.preview.conflicts.length - 8} more
              </div>
            ) : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            disabled={!pending || applying}
            onClick={() => pending && void finish(pending.request, "skip")}
          >
            Skip all
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!pending || applying}
            onClick={() => pending && void finish(pending.request, "replace")}
          >
            {applying ? "Applying…" : "Replace all"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { startTransfer, conflictDialog, applying };
}
