import { useQuery } from "@tanstack/react-query";
import { BookOpen, Cloud, Lock, PackageOpen } from "lucide-react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUiStore } from "@/stores/ui";

export function MarkdownViewer() {
  const selectedPath = useUiStore((s) => s.selectedPath);
  const setActivePanel = useUiStore((s) => s.setActivePanel);

  const treeQuery = useQuery({
    queryKey: ["tree"],
    queryFn: api.vaultListTree,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["file", selectedPath],
    queryFn: () => api.vaultReadFile(selectedPath!),
    enabled: !!selectedPath,
  });

  const vaultEmpty = !treeQuery.isLoading && (treeQuery.data?.length ?? 0) === 0;

  if (treeQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Loading library…
      </div>
    );
  }

  if (vaultEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-full bg-muted p-4"
        >
          <PackageOpen className="size-8 text-primary" />
        </motion.div>
        <div>
          <h2 className="font-display text-xl">Your library is empty</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Download a knowledge pack from the Hub to get started.
          </p>
        </div>
        <Button onClick={() => setActivePanel("hub")}>
          <Cloud className="size-4" />
          Open Hub
        </Button>
      </div>
    );
  }

  if (!selectedPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-full bg-muted p-4"
        >
          <BookOpen className="size-8 text-primary" />
        </motion.div>
        <div>
          <h2 className="font-display text-xl">Select a knowledge file</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Browse the library tree. Knowledge files are read-only after download.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{selectedPath.split("/").pop()}</p>
          <p className="truncate text-xs text-muted-foreground">{selectedPath}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          <Lock className="size-3" />
          Read-only
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="max-w-3xl px-6 py-5">
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {error && (
            <p className="text-destructive">
              {(error as Error).message || "Failed to load file"}
            </p>
          )}
          {data && (
            <motion.div
              key={selectedPath}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <MarkdownBody>{data}</MarkdownBody>
            </motion.div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
