import type {
  FileChangeStatus,
  InstalledPack,
  TreeNode,
} from "@nest/shared";
import { save } from "@tauri-apps/plugin-dialog";
import {
  FileText,
  Folder,
  FolderInput,
  Image as ImageIcon,
  Search,
} from "lucide-react";
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { NewVaultEntryDialog } from "@/components/library/NewVaultEntryDialog";
import { useVaultTransfer } from "@/components/library/VaultTransferController";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { canEditPack, isPackReviewLocked } from "@/lib/pack-permissions";
import {
  fileMutationInvalidations,
  packMutationInvalidations,
  queryKeys,
} from "@/lib/query-keys";
import {
  collectEditableVaultDestinations,
  type VaultDestination,
} from "@/lib/vault-destinations";
import {
  destinationFolderForNode,
  normalizeVaultDragEntries,
  rangeSelection,
  validateVaultDrop,
  type VaultDragEntry,
} from "@/lib/tree-drag-drop";
import {
  ensureMdExtension,
  fileName,
  isImagePath,
  joinPath,
  parentDir,
} from "@/lib/vault-paths";
import {
  DropTargetContext,
  ExplorerActionsContext,
  ExplorerFileStatusContext,
  filterTree,
  GeneralExplorerMenuItems,
  PackSection,
  type NewEntryKind,
} from "@/components/library/TreeItem";
import { useEditorStore } from "@/stores/editor";
import { useUiStore } from "@/stores/ui";

export function LibraryTree({
  tree,
  installed,
  dropTargetPath = null,
  onCreatePack,
  onImportFolder,
  onImportZip,
}: {
  tree: TreeNode[];
  installed: InstalledPack[];
  dropTargetPath?: string | null;
  onCreatePack: () => void;
  onImportFolder: () => void;
  onImportZip: () => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [inactiveOpen, setInactiveOpen] = useState("");
  const [inactiveResetKey, setInactiveResetKey] = useState(0);
  const [internalDropTargetNodePath, setInternalDropTargetNodePath] = useState<
    string | null
  >(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const [dragVisual, setDragVisual] = useState<{
    entries: VaultDragEntry[];
    x: number;
    y: number;
  } | null>(null);
  const [newEntryRequest, setNewEntryRequest] = useState<{
    kind: NewEntryKind;
    preferredDestination?: string;
  } | null>(null);
  const dragSourceRef = useRef<VaultDragEntry[] | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerDraggingRef = useRef(false);
  const dragReplacesSelectionRef = useRef(false);
  const suppressClickRef = useRef(false);
  const queryClient = useQueryClient();
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const openFileTab = useUiStore((s) => s.openFileTab);
  const openAccountTab = useUiStore((s) => s.openAccountTab);
  const setEditing = useEditorStore((s) => s.setEditing);
  const setDirty = useEditorStore((s) => s.setDirty);
  const { startTransfer, conflictDialog, applying: transferPending } =
    useVaultTransfer();

  const hubAuthQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const hubUser = hubAuthQuery.data?.user ?? null;

  const registryPacks = useMemo(
    () => installed.filter((pack) => pack.origin === "registry"),
    [installed],
  );
  const registryStatusQueries = useQueries({
    queries: registryPacks.map((pack) => ({
      queryKey: queryKeys.packStatus(pack.pack_id),
      queryFn: () => api.hubPackChangeStatus(pack.pack_id),
    })),
  });
  const explorerFileStatuses = useMemo(() => {
    const statuses = new Map<string, FileChangeStatus>();
    for (const query of registryStatusQueries) {
      for (const file of query.data ?? []) statuses.set(file.path, file.status);
    }
    return statuses;
  }, [registryStatusQueries]);
  const authenticated = hubAuthQuery.data?.authenticated ?? false;

  const byPath = useMemo(() => {
    const map = new Map<string, InstalledPack>();
    for (const p of installed) {
      map.set(p.local_path, p);
      map.set(p.pack_id, p);
    }
    return map;
  }, [installed]);

  const editableDestinations = useMemo(
    () => collectEditableVaultDestinations(tree, installed, hubUser),
    [tree, installed, hubUser],
  );

  const createEntry = useMutation({
    mutationFn: ({
      kind,
      destination,
      name,
    }: {
      kind: NewEntryKind;
      destination: VaultDestination;
      name: string;
    }) => {
      const path = joinPath(
        destination.path,
        kind === "file" ? ensureMdExtension(name) : name,
      );
      return kind === "file"
        ? api.vaultCreateFile(path)
        : api.vaultCreateFolder(path);
    },
    onSuccess: (_void, vars) => {
      setNewEntryRequest(null);
      for (const key of fileMutationInvalidations(vars.destination.packId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (vars.kind === "file") {
        const path = joinPath(
          vars.destination.path,
          ensureMdExtension(vars.name),
        );
        setEditing(path, true);
        openFileTab(path, { preview: false });
      } else {
        toast.success("Folder created");
      }
    },
    onError: (error) =>
      toast.error("Could not create item", { description: appErrorMessage(error) }),
  });

  const openNewEntryDialog = (
    kind: NewEntryKind,
    preferredDestination?: string,
  ) => {
    createEntry.reset();
    setNewEntryRequest({ kind, preferredDestination });
  };

  const openVaultFolder = () => {
    void api.vaultOpenFolder().catch((error) =>
      toast.error("Could not open vault folder", {
        description: appErrorMessage(error),
      }),
    );
  };

  const existingPaths = useMemo(() => {
    const paths = new Set<string>();
    const visit = (node: TreeNode) => {
      paths.add(node.path);
      for (const child of node.children ?? []) visit(child);
    };
    for (const node of tree) visit(node);
    return paths;
  }, [tree]);

  const nodeByPath = useMemo(() => {
    const nodes = new Map<string, TreeNode>();
    const visit = (node: TreeNode) => {
      nodes.set(node.path, node);
      for (const child of node.children ?? []) visit(child);
    };
    for (const node of tree) visit(node);
    return nodes;
  }, [tree]);

  useEffect(() => {
    setSelectedPaths((current) => {
      const next = new Set(
        [...current].filter((path) => nodeByPath.has(path)),
      );
      return next.size === current.size ? current : next;
    });
  }, [nodeByPath]);

  const findPackForPath = (path: string) => {
    let match: InstalledPack | undefined;
    for (const pack of installed) {
      if (
        (path === pack.local_path || path.startsWith(`${pack.local_path}/`)) &&
        (!match || pack.local_path.length > match.local_path.length)
      ) {
        match = pack;
      }
    }
    return match;
  };

  const validateDrop = (sources: VaultDragEntry[], target: TreeNode) => {
    const destinationFolder = destinationFolderForNode(target);
    const destinationPack = findPackForPath(destinationFolder);
    if (destinationPack && isPackReviewLocked(destinationPack)) {
      return {
        valid: false as const,
        reason:
          "Files cannot be moved into a pack while its publish request is under review.",
      };
    }
    const movable = sources.filter(
      (source) => parentDir(source.path) !== destinationFolder,
    );
    if (movable.length === 0) {
      return {
        valid: false as const,
        reason: "The selected items are already in that folder.",
      };
    }
    for (const source of movable) {
      const sourcePack = findPackForPath(source.path);
      if (sourcePack && isPackReviewLocked(sourcePack)) {
        return {
          valid: false as const,
          reason:
            "Files cannot be moved out of a pack while its publish request is under review.",
        };
      }
      const validation = validateVaultDrop({
        source,
        target,
        sourceEditable: Boolean(
          sourcePack && canEditPack(sourcePack, hubUser),
        ),
        destinationEditable: Boolean(
          destinationPack && canEditPack(destinationPack, hubUser),
        ),
        targetExists: existingPaths.has(target.path),
        existingPaths,
        allowExistingDestination: true,
      });
      if (!validation.valid) return validation;
    }
    return { valid: true as const, destinationFolder, sources: movable };
  };

  const finishMove = (
    sources: VaultDragEntry[],
    destinationFolder: string,
    result: { removed_paths: string[]; replaced_paths: string[] },
  ) => {
    for (const affected of [
      ...result.removed_paths,
      ...result.replaced_paths,
    ]) {
      clearPathsUnder(affected);
      setEditing(affected, false);
      setDirty(affected, false);
    }
    setSelectedPaths((current) => {
      const next = new Set(current);
      for (const selected of current) {
        if (
          result.removed_paths.some(
            (removed) =>
              selected === removed || selected.startsWith(`${removed}/`),
          )
        ) {
          next.delete(selected);
        }
      }
      return next;
    });
    const packIds = new Set<string>();
    for (const source of sources) {
      const pack = findPackForPath(source.path);
      if (pack) packIds.add(pack.pack_id);
    }
    const destinationPack = findPackForPath(destinationFolder);
    if (destinationPack) packIds.add(destinationPack.pack_id);
    for (const packId of packIds) {
      for (const key of fileMutationInvalidations(packId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    }
  };

  const endInternalDrag = () => {
    dragSourceRef.current = null;
    pointerStartRef.current = null;
    pointerDraggingRef.current = false;
    dragReplacesSelectionRef.current = false;
    setInternalDropTargetNodePath(null);
    setDragVisual(null);
    document.body.style.cursor = "";
  };

  useEffect(() => {
    const targetAtPoint = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y);
      const row = element?.closest<HTMLElement>("[data-vault-path]");
      const path = row?.dataset.vaultPath;
      return path ? nodeByPath.get(path) : undefined;
    };

    const onPointerMove = (event: PointerEvent) => {
      const sources = dragSourceRef.current;
      const start = pointerStartRef.current;
      if (!sources || !start) return;

      if (!pointerDraggingRef.current) {
        const distance = Math.hypot(
          event.clientX - start.x,
          event.clientY - start.y,
        );
        if (distance < 5) return;
        pointerDraggingRef.current = true;
        if (dragReplacesSelectionRef.current) {
          setSelectedPaths(new Set(sources.map((source) => source.path)));
          selectionAnchorRef.current = sources[0]?.path ?? null;
        }
        suppressClickRef.current = true;
        document.body.style.cursor = "grabbing";
      }

      event.preventDefault();
      setDragVisual({ entries: sources, x: event.clientX, y: event.clientY });
      const target = targetAtPoint(event.clientX, event.clientY);
      if (!target) {
        setInternalDropTargetNodePath(null);
        return;
      }
      const validation = validateDrop(sources, target);
      setInternalDropTargetNodePath(
        validation.valid ? validation.destinationFolder : null,
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      const sources = dragSourceRef.current;
      if (!sources) return;
      if (!pointerDraggingRef.current) {
        endInternalDrag();
        return;
      }

      event.preventDefault();
      const target = targetAtPoint(event.clientX, event.clientY);
      if (target) {
        const validation = validateDrop(sources, target);
        if (validation.valid) {
          void startTransfer({
            destDir: validation.destinationFolder,
            sourcePaths: validation.sources.map((source) => source.path),
            operation: "move",
            onComplete: (result) =>
              finishMove(
                validation.sources,
                validation.destinationFolder,
                result,
              ),
          });
        } else {
          toast.error("Cannot move items", { description: validation.reason });
        }
      }
      endInternalDrag();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const onPointerCancel = () => {
      endInternalDrag();
      suppressClickRef.current = false;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onPointerCancel);
    };
  });

  const dropContext = {
    externalDropTargetPath: dropTargetPath,
    internalDropTargetNodePath,
    draggingPaths: new Set(
      dragVisual?.entries.map((entry) => entry.path) ?? [],
    ),
    selectedPaths,
    selectEntry: (
      entry: VaultDragEntry,
      event: ReactMouseEvent<HTMLElement>,
    ) => {
      const toggle = event.metaKey || event.ctrlKey;
      if (event.shiftKey && selectionAnchorRef.current) {
        const visible = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[data-explorer-tree] [data-vault-draggable='true']",
          ),
        )
          .map((element) => element.dataset.vaultPath)
          .filter((path): path is string => Boolean(path));
        setSelectedPaths((current) =>
          rangeSelection(
            visible,
            selectionAnchorRef.current!,
            entry.path,
            current,
            toggle,
          ) ?? current,
        );
        return true;
      }
      selectionAnchorRef.current = entry.path;
      if (toggle) {
        setSelectedPaths((current) => {
          const next = new Set(current);
          if (next.has(entry.path)) next.delete(entry.path);
          else next.add(entry.path);
          return next;
        });
        return true;
      }
      setSelectedPaths(new Set([entry.path]));
      return false;
    },
    beginPointerDrag: (
      entry: VaultDragEntry,
      event: ReactPointerEvent<HTMLElement>,
    ) => {
      if (event.button !== 0 || transferPending) return;
      const candidates = selectedPaths.has(entry.path)
        ? [...selectedPaths]
            .map((path) => nodeByPath.get(path))
            .filter((node): node is TreeNode => Boolean(node))
        : [entry];
      const entries = normalizeVaultDragEntries(candidates);
      dragReplacesSelectionRef.current = !selectedPaths.has(entry.path);
      dragSourceRef.current = entries;
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      pointerDraggingRef.current = false;
      suppressClickRef.current = false;
    },
    suppressTreeClick: () => suppressClickRef.current,
    pathExists: (path: string) => existingPaths.has(path),
  };

  const { activeRoots, inactiveRoots } = useMemo(() => {
    const active: TreeNode[] = [];
    const inactive: TreeNode[] = [];
    for (const node of tree) {
      if (node.kind !== "folder") continue;
      const meta = byPath.get(node.path);
      // Untracked folders count as active so they stay usable.
      if (meta && !meta.active) inactive.push(node);
      else active.push(node);
    }
    return { activeRoots: active, inactiveRoots: inactive };
  }, [tree, byPath]);

  const setActive = useMutation({
    mutationFn: ({ packId, active }: { packId: string; active: boolean }) =>
      api.hubSetPackActive(packId, active),
    onSuccess: (_void, vars) => {
      if (!vars.active) {
        clearPathsUnder(vars.packId);
        const local = byPath.get(vars.packId)?.local_path;
        if (local && local !== vars.packId) clearPathsUnder(local);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.installedPacks });
      toast.success(
        vars.active ? "Knowledge pack activated" : "Knowledge pack deactivated",
      );
    },
    onError: (e) =>
      toast.error("Could not update pack", { description: appErrorMessage(e) }),
  });

  const exportPack = useMutation({
    mutationFn: ({
      packId,
      destinationPath,
    }: {
      packId: string;
      destinationPath: string;
    }) => api.hubExportPack(packId, destinationPath),
    onSuccess: () => toast.success(t("hub.packExported")),
    onError: (e) =>
      toast.error(t("hub.exportFailed"), { description: appErrorMessage(e) }),
  });

  const uninstallPack = useMutation({
    mutationFn: (packId: string) => api.hubRemovePack(packId),
    onSuccess: (_status, packId) => {
      const localPath = byPath.get(packId)?.local_path ?? packId;
      clearPathsUnder(localPath);
      for (const key of packMutationInvalidations) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(t("hub.packRemoved"));
    },
    onError: (e) =>
      toast.error(t("hub.removeFailed"), { description: appErrorMessage(e) }),
  });

  const renamePack = useMutation({
    mutationFn: ({ packId, name }: { packId: string; name: string }) =>
      api.hubRenamePack(packId, name),
    onSuccess: (_data, vars) => {
      toast.success("Pack renamed");
      const oldLocalPath = byPath.get(vars.packId)?.local_path ?? vars.packId;
      clearPathsUnder(oldLocalPath);
      for (const key of packMutationInvalidations) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (error: unknown) =>
      toast.error(appErrorMessage(error, "Could not rename pack")),
  });

  const handleExport = async (packId: string) => {
    const pack = byPath.get(packId);
    const destination = await save({
      title: t("hub.exportKnowledgePack"),
      defaultPath: pack
        ? `${pack.pack_id}-${pack.version}.zip`
        : `${packId}.zip`,
      filters: [{ name: "Knowledge pack", extensions: ["zip"] }],
    });
    if (destination)
      exportPack.mutate({ packId, destinationPath: destination });
  };

  const forceOpen = search.trim().length > 0;
  const inactiveMatches = useMemo(
    () => filterTree(inactiveRoots, search),
    [inactiveRoots, search],
  );

  // Expand inactive accordion when search hits something inside it.
  useEffect(() => {
    if (forceOpen && inactiveMatches.length > 0) {
      setInactiveOpen("inactive");
    }
  }, [forceOpen, inactiveMatches.length]);

  return (
    <ExplorerActionsContext.Provider
      value={{
        canCreateEntry: editableDestinations.length > 0,
        onCreatePack,
        onImportFolder,
        onImportZip,
        onCreateEntry: openNewEntryDialog,
        onOpenVaultFolder: openVaultFolder,
      }}
    >
      <DropTargetContext.Provider value={dropContext}>
        <ExplorerFileStatusContext.Provider value={explorerFileStatuses}>
        {dragVisual &&
          createPortal(
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: -3 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none fixed z-[100] flex max-w-64 items-center gap-2 rounded-md border border-primary/30 bg-popover/95 px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg backdrop-blur-sm"
              style={{ left: dragVisual.x + 14, top: dragVisual.y + 14 }}
            >
              {dragVisual.entries.length > 1 ? (
                <FolderInput className="size-3.5 shrink-0 text-primary" />
              ) : dragVisual.entries[0]?.kind === "folder" ? (
                <Folder className="size-3.5 shrink-0 text-primary" />
              ) : isImagePath(dragVisual.entries[0]?.path ?? "") ? (
                <ImageIcon className="size-3.5 shrink-0 text-primary" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-primary" />
              )}
              <span className="truncate font-medium">
                {dragVisual.entries.length === 1
                  ? dragVisual.entries[0]?.name
                  : `${dragVisual.entries.length} items`}
              </span>
              {internalDropTargetNodePath && (
                <span className="shrink-0 text-muted-foreground">
                  → {fileName(internalDropTargetNodePath)}
                </span>
              )}
            </motion.div>,
            document.body,
          )}
        <div className="flex h-full min-h-0 flex-col">
          <div className="px-2 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search knowledge…"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className="min-h-0 flex-1 overflow-y-auto py-1"
                data-explorer-tree
              >
                {tree.length === 0 ? (
                  <div className="flex flex-col gap-2 p-4">
                    <p className="text-sm font-medium text-foreground">
                      No packs yet
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Download from Hub or create a knowledge pack to get started.
                    </p>
                  </div>
                ) : (
                  <>
                    <PackSection
                      title="Active"
                      nodes={activeRoots}
                      packActive
                      search={search}
                      forceOpen={forceOpen}
                      byPath={byPath}
                      hubUser={hubUser}
                      setActivePending={setActive.isPending}
                      onSetActive={(packPath, active) => {
                        const packId =
                          byPath.get(packPath)?.pack_id ?? packPath;
                        setActive.mutate({ packId, active });
                      }}
                      authenticated={authenticated}
                      onSignIn={openAccountTab}
                      onExport={handleExport}
                      exportPending={exportPack.isPending}
                      onUninstallPack={(packId) =>
                        uninstallPack.mutate(packId)
                      }
                      uninstallPending={uninstallPack.isPending}
                      onRenamePack={(packId, name) =>
                        renamePack.mutate({ packId, name })
                      }
                      renamePackPending={renamePack.isPending}
                    />
                    <PackSection
                      title="Inactive"
                      nodes={inactiveRoots}
                      packActive={false}
                      search={search}
                      forceOpen={forceOpen}
                      byPath={byPath}
                      hubUser={hubUser}
                      collapsible
                      accordionValue={inactiveOpen}
                      onAccordionChange={(value) => {
                        setInactiveOpen(value);
                        setInactiveResetKey((k) => k + 1);
                      }}
                      resetKey={inactiveResetKey}
                      setActivePending={setActive.isPending}
                      onSetActive={(packPath, active) => {
                        const packId =
                          byPath.get(packPath)?.pack_id ?? packPath;
                        setActive.mutate({ packId, active });
                      }}
                      authenticated={authenticated}
                      onSignIn={openAccountTab}
                      onExport={handleExport}
                      exportPending={exportPack.isPending}
                      onUninstallPack={(packId) =>
                        uninstallPack.mutate(packId)
                      }
                      uninstallPending={uninstallPack.isPending}
                      onRenamePack={(packId, name) =>
                        renamePack.mutate({ packId, name })
                      }
                      renamePackPending={renamePack.isPending}
                    />
                    {search.trim() &&
                      filterTree(activeRoots, search).length === 0 &&
                      inactiveMatches.length === 0 && (
                        <p className="px-3 py-2 text-sm text-muted-foreground">
                          No matches.
                        </p>
                      )}
                  </>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <GeneralExplorerMenuItems includePackImports />
            </ContextMenuContent>
          </ContextMenu>
        </div>
        <NewVaultEntryDialog
          open={newEntryRequest != null}
          onOpenChange={(open) => {
            if (!open && !createEntry.isPending) setNewEntryRequest(null);
          }}
          kind={newEntryRequest?.kind ?? "file"}
          destinations={editableDestinations}
          preferredDestination={newEntryRequest?.preferredDestination}
          creating={createEntry.isPending}
          error={
            createEntry.error ? appErrorMessage(createEntry.error) : undefined
          }
          onCreate={(destination, name) => {
            if (!newEntryRequest) return;
            createEntry.mutate({
              kind: newEntryRequest.kind,
              destination,
              name,
            });
          }}
        />
        {conflictDialog}
        </ExplorerFileStatusContext.Provider>
      </DropTargetContext.Provider>
    </ExplorerActionsContext.Provider>
  );
}
