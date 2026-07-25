import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";

export function DeleteReleaseDialog({
  target,
  onOpenChange,
  busy,
  onConfirm,
}: {
  target: { packName: string; version: string; isLast: boolean } | null;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onConfirm: () => void;
}) {
  const isLast = target?.isLast ?? false;
  return (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={onOpenChange}
      title={isLast ? "Delete the entire knowledge pack" : "Delete release"}
      description={
        isLast
          ? `v${target?.version ?? ""} is the only remaining version of ${target?.packName ?? "this pack"}.`
          : `Permanently delete ${target?.packName ?? "this pack"} v${target?.version ?? ""}.`
      }
      confirmLabel={isLast ? "Delete entire pack" : "Delete release"}
      busyLabel="Deleting…"
      icon={<Trash2 />}
      busy={busy}
      disabled={!target}
      onConfirm={onConfirm}
    >
      {isLast ? (
        <p className="text-sm leading-6 text-destructive">
          Deleting it removes the entire knowledge pack — the catalog entry,
          all history, access grants, and maintainers. This action cannot be
          undone.
        </p>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          This removes the release's registry files and its entry in the
          catalog. This action cannot be undone.
        </p>
      )}
    </ConfirmDialog>
  );
}
