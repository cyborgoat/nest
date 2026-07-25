import { Trash2 } from "lucide-react";
import type { AdminPack as Pack } from "@nest/shared";
import { ConfirmDialog } from "./ConfirmDialog";

export function DeletePackDialog({
  pack,
  onOpenChange,
  busy,
  onConfirm,
}: {
  pack: Pack | null;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onConfirm: () => void;
}) {
  const releaseCount = pack?.releases.length ?? 0;
  return (
    <ConfirmDialog
      open={Boolean(pack)}
      onOpenChange={onOpenChange}
      title="Delete knowledge pack"
      description={`Permanently delete ${pack?.name ?? "this pack"} and all published releases.`}
      confirmLabel="Delete permanently"
      busyLabel="Deleting…"
      icon={<Trash2 />}
      busy={busy}
      disabled={!pack}
      onConfirm={onConfirm}
    >
      <p className="text-sm leading-6 text-muted-foreground">
        This removes the registry files, {releaseCount} published release
        {releaseCount === 1 ? "" : "s"}, access grants, and pending
        submissions. This action cannot be undone.
      </p>
    </ConfirmDialog>
  );
}
