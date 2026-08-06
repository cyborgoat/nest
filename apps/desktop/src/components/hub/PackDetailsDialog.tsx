import { Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export function PackDetailsDialog({
  open,
  onOpenChange,
  name,
  description,
  version,
  packId,
  fromHub = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  description: string;
  version?: string;
  packId: string;
  fromHub?: boolean;
}) {
  const catalogQuery = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.hubListPacks,
    enabled: open && fromHub,
  });
  const catalogPack = catalogQuery.data?.find((pack) => pack.id === packId);
  const maintainerNames =
    catalogPack?.maintainers.map((user) => user.name) ?? [];
  const attributionUnavailable =
    catalogQuery.isError || (!catalogQuery.isLoading && !catalogPack);
  const authorLabel = catalogQuery.isLoading
    ? "Loading…"
    : attributionUnavailable
      ? "Unavailable"
      : (catalogPack?.author?.name ?? "Unassigned");
  const maintainersLabel = catalogQuery.isLoading
    ? "Loading…"
    : attributionUnavailable
      ? "Unavailable"
      : maintainerNames.length > 0
        ? maintainerNames.join(", ")
        : "None assigned";

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
        {fromHub && (
          <div className="grid gap-1 text-sm">
            <div className="flex items-start justify-center gap-2">
              <span className="text-muted-foreground">Author</span>
              <span className="font-medium">{authorLabel}</span>
            </div>
            <div className="flex items-start justify-center gap-2">
              <span className="text-muted-foreground">Maintainers</span>
              <span className="font-medium">{maintainersLabel}</span>
            </div>
          </div>
        )}
        <DialogDescription className="text-sm leading-6">
          {description || "No description provided."}
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
