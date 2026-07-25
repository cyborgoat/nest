import { useQuery } from "@tanstack/react-query";
import { GitCompare } from "lucide-react";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { buildSideBySideRows, type DiffRow } from "@/lib/side-by-side-diff";
import { cn } from "@/lib/utils";

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
  const diffQuery = useQuery({
    queryKey: queryKeys.fileDiff(packId, path),
    queryFn: () => api.hubPackFileDiff(packId, path),
  });

  const rows = diffQuery.data
    ? buildSideBySideRows(diffQuery.data.old ?? "", diffQuery.data.new ?? "")
    : [];

  return (
    <div className="flex h-full flex-col">
      <PanelHeader size="compact">
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
