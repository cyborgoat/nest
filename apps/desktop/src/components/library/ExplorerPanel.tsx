import type { InstalledPack, KnowledgePackMeta, TreeNode } from "@nest/shared";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LibraryTree } from "@/components/library/LibraryTree";
import { NewPackDialog } from "@/components/library/NewPackDialog";
import {
  LocalPackImportController,
  type LocalPackImportMode,
} from "@/components/hub/LocalPackImportController";
import { Button } from "@/components/ui/button";
import { SidebarPaneHeader } from "@/components/ui/sidebar-pane-header";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import {
  isPointOverEditor,
  isPointOverExplorer,
  vaultFolderPathAtPoint,
} from "@/lib/drop-targets";
import { canEditPack, packEditBlockReason } from "@/lib/pack-permissions";
import {
  fileMutationInvalidations,
  packMutationInvalidations,
  queryKeys,
} from "@/lib/query-keys";
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
  const [importMode, setImportMode] = useState<LocalPackImportMode | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const dropTargetRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const openFileTab = useUiStore((s) => s.openFileTab);
  const setEditing = useEditorStore((s) => s.setEditing);

  const hubAuthQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const hubUser = hubAuthQuery.data?.user ?? null;

  const byPath = useMemo(() => {
    const map = new Map<string, InstalledPack>();
    for (const p of installed) {
      map.set(p.local_path, p);
      map.set(p.pack_id, p);
    }
    return map;
  }, [installed]);

  const createPack = useMutation({
    mutationFn: (metadata: KnowledgePackMeta) =>
      api.hubCreateEmptyPack(metadata),
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

  const importIntoFolder = useRef(
    async (_folder: string, _paths: string[]) => {},
  );
  importIntoFolder.current = async (folder: string, paths: string[]) => {
    const packRoot = folder.split("/")[0] ?? folder;
    const pack = byPath.get(packRoot);
    if (!pack || !canEditPack(pack, hubUser)) {
      toast.error("Cannot import here", {
        description: pack
          ? packEditBlockReason(pack, hubUser)
          : "You don't have edit access to this pack.",
      });
      return;
    }
    try {
      const result = await api.vaultImportFiles(folder, paths);
      const packId = pack.pack_id;
      for (const key of fileMutationInvalidations(packId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      const n = result.imported.length;
      if (n > 0) {
        toast.success(
          n === 1 ? "Imported 1 file" : `Imported ${n} files`,
          result.skipped.length
            ? { description: `Skipped: ${result.skipped.join("; ")}` }
            : undefined,
        );
      }
    } catch (e) {
      toast.error("Could not import files", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        const type = event.payload.type;
        if (type === "leave") {
          dropTargetRef.current = null;
          setDropTargetPath(null);
          return;
        }
        if (type === "enter" || type === "over") {
          const { x, y } = event.payload.position;
          if (!isPointOverExplorer(x, y) || isPointOverEditor(x, y)) {
            dropTargetRef.current = null;
            setDropTargetPath(null);
            return;
          }
          const folder = vaultFolderPathAtPoint(x, y);
          dropTargetRef.current = folder;
          setDropTargetPath(folder);
          return;
        }
        if (type === "drop") {
          const { x, y } = event.payload.position;
          const paths = event.payload.paths ?? [];
          const folder =
            dropTargetRef.current ?? vaultFolderPathAtPoint(x, y);
          dropTargetRef.current = null;
          setDropTargetPath(null);
          if (!folder || paths.length === 0) return;
          if (!isPointOverExplorer(x, y) || isPointOverEditor(x, y)) return;
          void importIntoFolder.current(folder, paths);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col" data-explorer-panel>
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
          <LibraryTree
            tree={tree}
            installed={installed}
            dropTargetPath={dropTargetPath}
            onCreatePack={() => setNewPackOpen(true)}
            onImportFolder={() => setImportMode("folder")}
            onImportZip={() => setImportMode("zip")}
          />
        )}
      </div>
      <NewPackDialog
        open={newPackOpen}
        onOpenChange={setNewPackOpen}
        onCreate={(metadata) => createPack.mutate(metadata)}
        creating={createPack.isPending}
        error={createPack.error?.message}
      />
      <LocalPackImportController
        mode={importMode}
        onModeChange={setImportMode}
        installed={installed}
      />
    </div>
  );
}
