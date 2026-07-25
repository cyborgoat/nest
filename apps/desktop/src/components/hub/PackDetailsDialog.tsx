import { Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function PackDetailsDialog({
  open,
  onOpenChange,
  name,
  description,
  version,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  description: string;
  version?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] text-center">
        <div className="mx-auto grid size-20 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Package className="size-10" />
        </div>
        <DialogTitle className="text-xl font-semibold tracking-tight">
          {name}
        </DialogTitle>
        {version && (
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="text-muted-foreground">Version</span>
            <span className="font-medium tabular-nums">{version}</span>
          </div>
        )}
        <DialogDescription className="text-sm leading-6">
          {description || "No description provided."}
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
