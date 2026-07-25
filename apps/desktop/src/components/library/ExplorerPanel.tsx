import type { InstalledPack, KnowledgePackMeta, TreeNode } from "@nest/shared";
import { Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { LibraryTree } from "@/components/library/LibraryTree";
import { NewPackDialog } from "@/components/library/NewPackDialog";
import { Button } from "@/components/ui/button";
import { SidebarPaneHeader } from "@/components/ui/sidebar-pane-header";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { packMutationInvalidations } from "@/lib/query-keys";
import { useEditorStore } from "@/stores/editor";
import { useUiStore } from "@/stores/ui";

export function ExplorerPanel({
  tree,
  installed,
  loading,
  error,
}: {
  tree: TreeNode[];
  installed: InstalledPack[];
  loading: boolean;
  error: Error | null;
}) {
  const [newPackOpen, setNewPackOpen] = useState(false);
  const queryClient = useQueryClient();
  const openFileTab = useUiStore((s) => s.openFileTab);
  const setEditing = useEditorStore((s) => s.setEditing);

  const createPack = useMutation({
    mutationFn: (metadata: KnowledgePackMeta) => api.hubCreateEmptyPack(metadata),
    onSuccess: (pack) => {
      setNewPackOpen(false);
      for (const key of packMutationInvalidations) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      const readmePath = `${pack.local_path}/README.md`;
      openFileTab(readmePath, { preview: false });
      setEditing(readmePath, true);
      toast.success("Knowledge pack created");
    },
    onError: (e: Error) =>
      toast.error("Could not create pack", { description: e.message }),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SidebarPaneHeader
        title="Explorer"
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="New knowledge pack"
                onClick={() => setNewPackOpen(true)}
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New knowledge pack</TooltipContent>
          </Tooltip>
        }
      />
      <div className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Spinner />
            Loading…
          </div>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{error.message}</p>
        ) : (
          <LibraryTree tree={tree} installed={installed} />
        )}
      </div>
      <NewPackDialog
        open={newPackOpen}
        onOpenChange={setNewPackOpen}
        onCreate={(metadata) => createPack.mutate(metadata)}
        creating={createPack.isPending}
        error={createPack.error?.message}
      />
    </div>
  );
}
