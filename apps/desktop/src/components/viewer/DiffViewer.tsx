import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCompare, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { fileMutationInvalidations, queryKeys } from "@/lib/query-keys";
import { buildSideBySideRows, type DiffRow } from "@/lib/side-by-side-diff";
import { cn } from "@/lib/utils";
import { diffTabId, useUiStore } from "@/stores/ui";

const ROW_BG: Record<DiffRow["type"], { old: string; new: string }> = {
  unchanged: { old: "", new: "" },
  removed: { old: "bg-destructive/10", new: "" },
  added: { old: "", new: "bg-emerald-500/10 dark:bg-emerald-500/15" },
  modified: {
    old: "bg-amber-500/10",
    new: "bg-amber-500/10",
  },
};

function DiffColumn({ rows, side }: { rows: DiffRow[]; side: "old" | "new" }) {
  return (
    <div className="min-w-0 flex-1 border-border first:border-r">
      <ScrollArea className="h-full">
        <div className="font-mono text-xs">
          {rows.map((row, i) => {
            const value = row[side];
            return (
              <div
                key={i}
                className={cn(
                  "flex px-2 py-0.5",
                  ROW_BG[row.type][side],
                  value === null && "opacity-0",
                )}
              >
                <span className="select-none whitespace-pre">
                  {value ?? " "}
                </span>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export function DiffViewer({ packId, path }: { packId: string; path: string }) {
  const queryClient = useQueryClient();
  const closeMainTab = useUiStore((s) => s.closeMainTab);

  const diffQuery = useQuery({
    queryKey: queryKeys.fileDiff(packId, path),
    queryFn: () => api.hubPackFileDiff(packId, path),
  });

  const discard = useMutation({
    mutationFn: () => api.hubPackDiscardFile(packId, path),
    onSuccess: () => {
      for (const key of fileMutationInvalidations(packId, path)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.fileDiff(packId, path) });
      toast.success("Change discarded");
      closeMainTab(diffTabId(packId, path));
    },
    onError: (e: Error) =>
      toast.error("Could not discard change", { description: e.message }),
  });

  const rows = diffQuery.data
    ? buildSideBySideRows(diffQuery.data.old ?? "", diffQuery.data.new ?? "")
    : [];

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        size="compact"
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={discard.isPending || diffQuery.isLoading}
            onClick={() => discard.mutate()}
          >
            <Undo2 className="size-3.5" />
            {discard.isPending ? "Discarding…" : "Discard changes"}
          </Button>
        }
      >
        <GitCompare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm text-muted-foreground">{path}</span>
      </PanelHeader>
      {diffQuery.isLoading ? (
        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
      ) : diffQuery.error ? (
        <p className="p-4 text-sm text-destructive">
          {(diffQuery.error as Error).message}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <DiffColumn rows={rows} side="old" />
          <DiffColumn rows={rows} side="new" />
        </div>
      )}
    </div>
  );
}
