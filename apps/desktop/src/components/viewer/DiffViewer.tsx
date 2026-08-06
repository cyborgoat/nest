import { useQuery } from "@tanstack/react-query";
import { FileQuestion, GitCompare, Image as ImageIcon } from "lucide-react";
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
  const lineCount = rows.reduce((n, row) => n + (row[side] !== null ? 1 : 0), 0);
  const gutterChars = Math.max(2, String(lineCount).length);
  let lineNo = 0;
  return (
    <div className="min-w-0 flex-1 border-border first:border-r">
      <ScrollArea className="h-full" orientation="both">
        <div className="pb-8 font-mono text-xs">
          {rows.map((row, i) => {
            const value = row[side];
            if (value !== null) lineNo++;
            return (
              <div
                key={i}
                className={cn(
                  "flex",
                  ROW_BG[row.type][side],
                  value === null && "opacity-0",
                )}
              >
                <span
                  className="sticky left-0 shrink-0 select-none whitespace-pre bg-background py-0.5 pr-2 pl-2 text-right text-muted-foreground/60"
                  style={{ width: `calc(${gutterChars}ch + 1rem)` }}
                >
                  {value !== null ? lineNo : ""}
                </span>
                <span className="select-none whitespace-pre py-0.5 pr-2">
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

  const rows = diffQuery.data?.kind === "text"
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
      ) : diffQuery.data?.kind === "image" ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x">
          <ImageSide label="Remote baseline" src={diffQuery.data.old} />
          <ImageSide label="Local working copy" src={diffQuery.data.new} />
        </div>
      ) : diffQuery.data?.kind === "binary" ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x">
          <BinarySide label="Remote baseline" value={diffQuery.data.old} />
          <BinarySide label="Local working copy" value={diffQuery.data.new} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <DiffColumn rows={rows} side="old" />
          <DiffColumn rows={rows} side="new" />
        </div>
      )}
    </div>
  );
}

function ImageSide({ label, src }: { label: string; src: string | null }) {
  return (
    <section className="flex min-w-0 flex-col">
      <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-muted/20 p-4">
        {src ? (
          <img src={src} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-center text-sm text-muted-foreground">
            <ImageIcon className="mx-auto mb-2 size-7" />
            File not present
          </div>
        )}
      </div>
    </section>
  );
}

function BinarySide({
  label,
  value,
}: {
  label: string;
  value: { size: number; checksum: string } | null;
}) {
  return (
    <section className="grid min-w-0 place-items-center p-6 text-center">
      <div>
        <FileQuestion className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{label}</p>
        {value ? (
          <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div>{value.size.toLocaleString()} bytes</div>
            <div className="font-mono">{value.checksum}</div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">File not present</p>
        )}
      </div>
    </section>
  );
}
