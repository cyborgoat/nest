import { useQuery } from "@tanstack/react-query";
import type { ChatFileChangeSummary } from "@nest/shared";
import { ChevronDown, FileDiff } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { buildSideBySideRows } from "@/lib/side-by-side-diff";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

export function ChatFileChanges({ changes, onReview }: { changes: ChatFileChangeSummary[]; onReview?: (path: string) => void }) {
  if (!changes.length) return null;
  return (
    <div className="mt-3 rounded-lg bg-muted/45 p-2">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium">
        <FileDiff className="size-3.5 text-primary" />
        {changes.length} {changes.length === 1 ? "file" : "files"} changed
      </div>
      <div className="space-y-1">
        {changes.map((change) => <Change key={change.id} change={change} onReview={onReview} />)}
      </div>
    </div>
  );
}

function Change({ change, onReview }: { change: ChatFileChangeSummary; onReview?: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: queryKeys.chatFileChange(change.id),
    queryFn: () => api.chatGetFileChange(change.id),
    enabled: open,
  });
  const rows = detail.data
    ? buildSideBySideRows(detail.data.old_content ?? "", detail.data.new_content ?? "")
    : [];
  return (
    <div className="overflow-hidden rounded-md bg-background/80">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/60">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", change.operation === "created" ? "bg-success/15 text-success" : change.operation === "deleted" ? "bg-destructive/15 text-destructive" : "bg-info/15 text-info")}>{change.operation}</span>
        <span className="min-w-0 flex-1 truncate font-mono">{change.path}</span>
        <span className="shrink-0 text-[10px] capitalize text-muted-foreground">{change.status}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="max-h-72 overflow-auto border-t border-border/60 font-mono text-[11px] leading-5">
          {detail.isLoading ? <p className="p-2 text-muted-foreground">Loading diff…</p> : rows.map((row, index) => (
            <div key={index} className={cn("grid grid-cols-[1rem_1fr] px-2", row.type === "added" && "bg-success/10 text-success", row.type === "removed" && "bg-destructive/10 text-destructive", row.type === "modified" && "bg-warning/10")}>
              <span className="select-none opacity-60">{row.old == null ? "+" : row.new == null ? "−" : " "}</span>
              <span className="whitespace-pre-wrap break-all">{row.new ?? row.old ?? ""}</span>
            </div>
          ))}
        </div>
      )}
      {change.status === "pending" && onReview && (
        <div className="border-t border-border/60 p-1.5 text-right">
          <button type="button" onClick={() => onReview(change.path)} className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90">Review in editor</button>
        </div>
      )}
    </div>
  );
}
