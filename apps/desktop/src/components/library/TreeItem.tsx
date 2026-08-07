import type {
  FileChangeStatus,
  HubUser,
  InstalledPack,
  TreeNode,
} from "@nest/shared";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileArchive,
  FilePlus2,
  FileText,
  FileUp,
  Folder,
  FolderInput,
  FolderPlus,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Minus,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  CloudUpload,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PackPublishDialogController } from "@/components/hub/PackPublishDialogController";
import { PackDetailsDialog } from "@/components/hub/PackDetailsDialog";
import { RenamePackDialog } from "@/components/hub/RenamePackDialog";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LETTER,
  STATUS_TEXT_CLASSES,
} from "@/lib/file-status-ui";
import { useI18n } from "@/lib/i18n";
import { afterMenuClose } from "@/lib/menu-actions";
import {
  canEditPack,
  canRenamePack,
  isPackReviewLocked,
} from "@/lib/pack-permissions";
import { pendingPublishVersionLabel } from "@/lib/publish-request-labels";
import { fileMutationInvalidations } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { VaultDragEntry } from "@/lib/tree-drag-drop";
import {
  ensureImageExtension,
  ensureMdExtension,
  isImagePath,
  joinPath,
  parentDir,
} from "@/lib/vault-paths";
import { useEditorStore } from "@/stores/editor";
import { useUiStore } from "@/stores/ui";

export const DropTargetContext = createContext<{
  externalDropTargetPath: string | null;
  internalDropTargetNodePath: string | null;
  draggingPaths: ReadonlySet<string>;
  selectedPaths: ReadonlySet<string>;
  selectEntry: (
    entry: VaultDragEntry,
    event: ReactMouseEvent<HTMLElement>,
  ) => boolean;
  beginPointerDrag: (
    entry: VaultDragEntry,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  suppressTreeClick: () => boolean;
  pathExists: (path: string) => boolean;
}>({
  externalDropTargetPath: null,
  internalDropTargetNodePath: null,
  draggingPaths: new Set(),
  selectedPaths: new Set(),
  selectEntry: () => false,
  beginPointerDrag: () => {},
  suppressTreeClick: () => false,
  pathExists: () => false,
});

export const ExplorerFileStatusContext = createContext<
  ReadonlyMap<string, FileChangeStatus>
>(new Map());

export type NewEntryKind = "file" | "folder";

export const ExplorerActionsContext = createContext<{
  canCreateEntry: boolean;
  onCreatePack: () => void;
  onImportFolder: () => void;
  onImportZip: () => void;
  onCreateEntry: (kind: NewEntryKind, preferredDestination?: string) => void;
  onOpenVaultFolder: () => void;
}>({
  canCreateEntry: false,
  onCreatePack: () => {},
  onImportFolder: () => {},
  onImportZip: () => {},
  onCreateEntry: () => {},
  onOpenVaultFolder: () => {},
});

export function GeneralExplorerMenuItems({
  preferredDestination,
  includePackImports = false,
}: {
  preferredDestination?: string;
  includePackImports?: boolean;
}) {
  const {
    canCreateEntry,
    onCreatePack,
    onImportFolder,
    onImportZip,
    onCreateEntry,
    onOpenVaultFolder,
  } = useContext(ExplorerActionsContext);

  return (
    <>
      <ContextMenuItem onSelect={() => afterMenuClose(onCreatePack)}>
        <PackagePlus className="size-3.5" />
        New Knowledge Pack
      </ContextMenuItem>
      {includePackImports && (
        <>
          <ContextMenuItem onSelect={() => afterMenuClose(onImportFolder)}>
            <FolderInput className="size-3.5" />
            Import Local Pack from Folder…
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => afterMenuClose(onImportZip)}>
            <FileArchive className="size-3.5" />
            Import Local Pack from ZIP…
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem
        disabled={!canCreateEntry}
        onSelect={() =>
          afterMenuClose(() => onCreateEntry("file", preferredDestination))
        }
      >
        <FilePlus2 className="size-3.5" />
        New File
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!canCreateEntry}
        onSelect={() =>
          afterMenuClose(() => onCreateEntry("folder", preferredDestination))
        }
      >
        <FolderPlus className="size-3.5" />
        New Folder
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => afterMenuClose(onOpenVaultFolder)}>
        <FolderOpen className="size-3.5" />
        Open Vault Folder
      </ContextMenuItem>
    </>
  );
}

export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const walk = (node: TreeNode): TreeNode | null => {
    const selfMatch =
      node.name.toLowerCase().includes(q) ||
      node.path.toLowerCase().includes(q);
    if (node.kind === "file") {
      return selfMatch ? node : null;
    }
    const kids = (node.children ?? [])
      .map(walk)
      .filter((n): n is TreeNode => n != null);
    if (selfMatch || kids.length > 0) {
      return { ...node, children: kids.length ? kids : node.children };
    }
    return null;
  };

  return nodes.map(walk).filter((n): n is TreeNode => n != null);
}

/** A ContextMenuItem that stays visible but disabled — with a hover tooltip
 * explaining why — instead of disappearing, so every row's menu has the same
 * shape regardless of the viewer's permissions. */
function PermissionMenuItem({
  disabled,
  reason,
  className,
  onSelect,
  children,
}: {
  disabled: boolean;
  reason?: string;
  className?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  const item = (
    <ContextMenuItem
      disabled={disabled}
      className={className}
      onSelect={onSelect}
    >
      {children}
    </ContextMenuItem>
  );
  if (!disabled || !reason) return item;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{item}</span>
      </TooltipTrigger>
      <TooltipContent side="right">{reason}</TooltipContent>
    </Tooltip>
  );
}

/** Inline text input for creating a new child file/folder under a tree node. */
function InlineCreateRow({
  depth,
  kind,
  onCancel,
  onSubmit,
}: {
  depth: number;
  kind: "file" | "folder";
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div
      className="flex items-center gap-1.5 py-1"
      style={{ paddingLeft: 8 + depth * 12 + 18 }}
    >
      {kind === "file" ? (
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={kind === "file" ? "filename.md" : "folder name"}
        className="h-6 flex-1 px-1.5 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed) onSubmit(trimmed);
            else onCancel();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
    </div>
  );
}

function TreeItem({
  node,
  depth = 0,
  forceOpen,
  packActive,
  canEdit,
  canRename,
  packId,
  installedPack,
  onSetActive,
  setActivePending,
  authenticated,
  onSignIn,
  onExport,
  exportPending,
  onUninstallPack,
  uninstallPending,
  onRenamePack,
  renamePackPending,
}: {
  node: TreeNode;
  depth?: number;
  forceOpen?: boolean;
  packActive: boolean;
  canEdit: boolean;
  canRename?: boolean;
  packId: string;
  installedPack?: InstalledPack;
  onSetActive?: (active: boolean) => void;
  setActivePending?: boolean;
  authenticated?: boolean;
  onSignIn?: () => void;
  onExport?: (packId: string) => void;
  exportPending?: boolean;
  onUninstallPack?: (packId: string) => void;
  uninstallPending?: boolean;
  onRenamePack?: (packId: string, name: string) => void;
  renamePackPending?: boolean;
}) {
  const [open, setOpen] = useState(!!forceOpen);
  const [renaming, setRenaming] = useState(false);
  const [creatingChild, setCreatingChild] = useState<"file" | "folder" | null>(
    null,
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);
  const [renamePackDialogOpen, setRenamePackDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const expandOnDragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  useEffect(
    () => () => {
      if (expandOnDragTimer.current) clearTimeout(expandOnDragTimer.current);
    },
    [],
  );

  const { t } = useI18n();
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const openFileTab = useUiStore((s) => s.openFileTab);
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const setEditing = useEditorStore((s) => s.setEditing);
  const setDirty = useEditorStore((s) => s.setDirty);
  const queryClient = useQueryClient();
  const isFolder = node.kind === "folder";
  const isRoot = depth === 0 && isFolder;
  const isImage = !isFolder && isImagePath(node.path);
  const fileStatus = useContext(ExplorerFileStatusContext).get(node.path);
  const isSelected = activeMainTabId === node.path;
  const editableHere = canEdit;
  const {
    externalDropTargetPath,
    internalDropTargetNodePath,
    draggingPaths,
    selectedPaths,
    selectEntry,
    beginPointerDrag,
    suppressTreeClick,
    pathExists,
  } = useContext(DropTargetContext);
  const isDropTarget =
    (isFolder && externalDropTargetPath === node.path) ||
    internalDropTargetNodePath === node.path;
  const isDragging = draggingPaths.has(node.path);
  const isMultiSelected = selectedPaths.has(node.path);
  const draggableHere = editableHere && !isRoot && pathExists(node.path);
  useEffect(() => {
    if (
      internalDropTargetNodePath !== node.path ||
      !isFolder ||
      open ||
      expandOnDragTimer.current
    ) {
      return;
    }
    expandOnDragTimer.current = setTimeout(() => {
      setOpen(true);
      expandOnDragTimer.current = null;
    }, 500);
    return () => {
      if (expandOnDragTimer.current) {
        clearTimeout(expandOnDragTimer.current);
        expandOnDragTimer.current = null;
      }
    };
  }, [internalDropTargetNodePath, isFolder, node.path, open]);
  const editReason = installedPack && isPackReviewLocked(installedPack)
      ? "This pack is locked while its publish request is under review."
    : !canEdit
      ? "You don't have edit access to this pack."
      : undefined;
  const renameReason = canRename
    ? undefined
    : installedPack && isPackReviewLocked(installedPack)
      ? "Cancel the pending publish request before renaming this pack."
      : "Only local packs can be renamed.";
  const publishLocked = Boolean(installedPack?.pending_version);
  const publishReason = publishLocked
      ? installedPack?.publish_review_status === "approved_awaiting_merge"
        ? `${pendingPublishVersionLabel(installedPack!)} is approved and must be merged first.`
        : `${pendingPublishVersionLabel(installedPack!)} is already awaiting review.`
    : !canEdit
      ? "You don't have edit access to this pack."
      : undefined;
  const origin = installedPack?.origin;
  // Packs downloaded from the hub get a distinct stroke color in the tree.
  const rootIconClass = origin === "registry" ? "text-info" : undefined;

  const invalidateAfterEdit = () => {
    for (const key of fileMutationInvalidations(packId)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const createChild = useMutation({
    mutationFn: ({ kind, name }: { kind: "file" | "folder"; name: string }) =>
      kind === "file"
        ? api.vaultCreateFile(joinPath(node.path, ensureMdExtension(name)))
        : api.vaultCreateFolder(joinPath(node.path, name)),
    onSuccess: (_void, vars) => {
      invalidateAfterEdit();
      if (vars.kind === "file") {
        const path = joinPath(node.path, ensureMdExtension(vars.name));
        setEditing(path, true);
        openFileTab(path, { preview: false });
      } else {
        toast.success("Folder created");
      }
    },
    onError: (e) =>
      toast.error("Could not create item", { description: appErrorMessage(e) }),
  });

  const importFiles = useMutation({
    mutationFn: (paths: string[]) => api.vaultImportFiles(node.path, paths),
    onSuccess: (result) => {
      invalidateAfterEdit();
      const count = result.imported.length;
      toast.success(count === 1 ? "Imported 1 file" : `Imported ${count} files`, {
        description: result.skipped.length
          ? `Skipped: ${result.skipped.join("; ")}`
          : undefined,
      });
    },
    onError: (e) =>
      toast.error("Could not import files", { description: appErrorMessage(e) }),
  });

  const chooseFilesToImport = async () => {
    try {
      const selected = await openDialog({
        title: `Import files into ${node.name}`,
        directory: false,
        multiple: true,
        filters: [
          {
            name: "Markdown and images",
            extensions: [
              "md",
              "png",
              "jpg",
              "jpeg",
              "gif",
              "webp",
              "svg",
              "bmp",
            ],
          },
        ],
      });
      const paths = Array.isArray(selected)
        ? selected
        : typeof selected === "string"
          ? [selected]
          : [];
      if (paths.length > 0) importFiles.mutate(paths);
    } catch (e) {
      toast.error("Could not open file picker", {
        description: appErrorMessage(e),
      });
    }
  };

  const rename = useMutation({
    mutationFn: (to: string) => api.vaultRenameEntry(node.path, to),
    onSuccess: () => {
      // The old path no longer exists; close any tabs pointing at it rather
      // than leave them showing a "no longer in your library" error.
      clearPathsUnder(node.path);
      setEditing(node.path, false);
      setDirty(node.path, false);
      invalidateAfterEdit();
    },
    onError: (e) =>
      toast.error("Could not rename", { description: appErrorMessage(e) }),
  });

  const remove = useMutation({
    mutationFn: () =>
      isFolder
        ? api.vaultDeleteFolder(node.path)
        : api.vaultDeleteFile(node.path),
    onSuccess: () => {
      clearPathsUnder(node.path);
      setEditing(node.path, false);
      setDirty(node.path, false);
      invalidateAfterEdit();
    },
    onError: (e) =>
      toast.error("Could not delete", { description: appErrorMessage(e) }),
  });

  const startRename = () => setRenaming(true);
  const startCreate = (kind: "file" | "folder") => {
    setOpen(true);
    setCreatingChild(kind);
  };
  const submitRename = (rawName: string) => {
    setRenaming(false);
    let name = rawName;
    if (!isFolder) {
      name = isImage
        ? ensureImageExtension(rawName, node.name)
        : ensureMdExtension(rawName);
    }
    const to = joinPath(parentDir(node.path), name);
    if (to !== node.path) rename.mutate(to);
  };
  const submitCreate = (kind: "file" | "folder", name: string) => {
    setCreatingChild(null);
    createChild.mutate({ kind, name });
  };

  const nameButton = (
    <button
      type="button"
      onPointerDown={(event) => {
        if (draggableHere) beginPointerDrag(node, event);
      }}
      className="flex min-w-0 flex-1 select-none items-center gap-1.5 py-1.5 text-left"
      onClick={(event) => {
        const selectionOnly = draggableHere ? selectEntry(node, event) : false;
        if (selectionOnly) return;
        if (isFolder) setOpen((v) => !v);
        else openFileTab(node.path);
      }}
      onDoubleClick={() => {
        if (!isFolder) openFileTab(node.path, { preview: false });
      }}
    >
      {isFolder ? (
        open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )
      ) : (
        <span className="inline-block size-3.5 shrink-0" />
      )}
      {isRoot ? (
        <Package
          className={cn(
            "size-3.5 shrink-0",
            rootIconClass ??
              (packActive ? "text-primary" : "text-muted-foreground"),
          )}
        />
      ) : isFolder ? (
        <Folder
          className={cn(
            "size-3.5 shrink-0",
            packActive ? "text-primary" : "text-muted-foreground",
          )}
        />
      ) : isImage ? (
        <ImageIcon
          className={cn(
            "size-3.5 shrink-0",
            packActive ? "text-primary" : "text-muted-foreground",
          )}
        />
      ) : (
        <FileText
          className={cn(
            "size-3.5 shrink-0",
            packActive ? "text-primary" : "text-muted-foreground",
          )}
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          !packActive && "opacity-80",
          fileStatus && STATUS_TEXT_CLASSES[fileStatus],
        )}
      >
        {node.name}
      </span>
    </button>
  );

  const row = (
    <div
      data-vault-path={node.path}
      data-vault-kind={isFolder ? "folder" : "file"}
      onContextMenu={(event) => event.stopPropagation()}
      onClickCapture={(event) => {
        if (suppressTreeClick()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      className={cn(
        "group flex min-w-0 select-none items-center gap-1 rounded-md pr-1 text-sm transition-all duration-150",
        isSelected || isMultiSelected
          ? "bg-primary/10 text-foreground"
          : "hover:bg-muted/80",
        isDropTarget && "relative z-10 bg-primary/15 ring-2 ring-primary/60",
        isDragging && "scale-[0.98] opacity-45",
        draggableHere && "cursor-grab active:cursor-grabbing",
        !packActive && "text-muted-foreground",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      data-vault-draggable={draggableHere ? "true" : undefined}
    >
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
          <span className="inline-block size-3.5 shrink-0" />
          {isRoot ? (
            <Package
              className={cn(
                "size-3.5 shrink-0",
                rootIconClass ?? "text-primary",
              )}
            />
          ) : isFolder ? (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          ) : isImage ? (
            <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Input
            autoFocus
            defaultValue={node.name}
            className="h-6 min-w-0 flex-1 px-1.5 text-xs"
            onFocus={(e) => {
              const dot = node.name.lastIndexOf(".");
              e.currentTarget.setSelectionRange(
                0,
                dot > 0 ? dot : node.name.length,
              );
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitRename(e.currentTarget.value.trim() || node.name);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setRenaming(false);
              }
            }}
            onBlur={(e) =>
              submitRename(e.currentTarget.value.trim() || node.name)
            }
          />
        </div>
      ) : (
        nameButton
      )}

      {!renaming && fileStatus && (
        <Badge
          variant={STATUS_BADGE_VARIANT[fileStatus]}
          className="shrink-0 px-1 py-0 text-[10px] leading-4"
        >
          {STATUS_LETTER[fileStatus]}
        </Badge>
      )}

      {isRoot && onSetActive && !renaming && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              disabled={setActivePending}
              aria-label={
                packActive
                  ? "Deactivate knowledge pack"
                  : "Activate knowledge pack"
              }
              onClick={(e) => {
                e.stopPropagation();
                onSetActive(!packActive);
              }}
            >
              {packActive ? (
                <Minus className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {packActive
              ? "Deactivate — exclude from chat knowledge"
              : "Activate — include in chat knowledge"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  const wrapped = (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {!isFolder && (
            <>
              <GeneralExplorerMenuItems
                preferredDestination={parentDir(node.path)}
              />
              <ContextMenuSeparator />
            </>
          )}
          {isFolder && (
            <>
              <PermissionMenuItem
                disabled={!editableHere}
                reason={editReason}
                onSelect={() => startCreate("file")}
              >
                <FilePlus2 className="size-3.5" />
                New File
              </PermissionMenuItem>
              <PermissionMenuItem
                disabled={!editableHere}
                reason={editReason}
                onSelect={() => startCreate("folder")}
              >
                <FolderPlus className="size-3.5" />
                New Folder
              </PermissionMenuItem>
              <PermissionMenuItem
                disabled={!editableHere || importFiles.isPending}
                reason={editReason}
                onSelect={() =>
                  afterMenuClose(() => void chooseFilesToImport())
                }
              >
                <FileUp className="size-3.5" />
                Import Files…
              </PermissionMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            onSelect={() =>
              afterMenuClose(() => {
                void api
                  .vaultRevealInFolder(node.path)
                  .catch((e) =>
                    toast.error("Could not reveal in folder", {
                      description: appErrorMessage(e),
                    }),
                  );
              })
            }
          >
            <FolderOpen className="size-3.5" />
            Reveal in Folder
          </ContextMenuItem>
          {!isRoot && (
            <>
              <ContextMenuSeparator />
              <PermissionMenuItem
                disabled={!editableHere}
                reason={editReason}
                onSelect={startRename}
              >
                <Pencil className="size-3.5" />
                Rename
              </PermissionMenuItem>
              <PermissionMenuItem
                disabled={!editableHere}
                reason={editReason}
                className="text-destructive focus:text-destructive"
                onSelect={() => afterMenuClose(() => setDeleteDialogOpen(true))}
              >
                <Trash2 className="size-3.5" />
                Delete
              </PermissionMenuItem>
            </>
          )}
          {isRoot && (
            <>
              <ContextMenuSeparator />
              {installedPack?.version && (
                <ContextMenuLabel>
                  Version {installedPack.version}
                </ContextMenuLabel>
              )}
              <ContextMenuItem
                onSelect={() =>
                  afterMenuClose(() => setDetailsDialogOpen(true))
                }
              >
                <Info className="size-3.5" />
                View Details
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={setActivePending}
                onSelect={() => onSetActive?.(!packActive)}
              >
                {packActive ? (
                  <Minus className="size-3.5" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                {packActive ? "Deactivate pack" : "Activate pack"}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={exportPending}
                onSelect={() => afterMenuClose(() => onExport?.(packId))}
              >
                <Download className="size-3.5" />
                Export ZIP
              </ContextMenuItem>
              <PermissionMenuItem
                disabled={!canRename}
                reason={renameReason}
                onSelect={() =>
                  afterMenuClose(() => setRenamePackDialogOpen(true))
                }
              >
                <Pencil className="size-3.5" />
                Rename pack
              </PermissionMenuItem>
              <PermissionMenuItem
                disabled={!canEdit || publishLocked}
                reason={publishReason}
                onSelect={() =>
                  afterMenuClose(() => {
                    if (authenticated) setPublishDialogOpen(true);
                    else onSignIn?.();
                  })
                }
              >
                <CloudUpload className="size-3.5" />
                {canEdit && !authenticated ? "Sign in to publish" : "Publish"}
              </PermissionMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() =>
                  afterMenuClose(() => setUninstallDialogOpen(true))
                }
              >
                <Trash2 className="size-3.5" />
                Uninstall
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {editableHere && (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {node.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {isFolder
                  ? "This deletes the folder and everything inside it. This can't be undone."
                  : "This can't be undone."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={cn(buttonVariants({ variant: "destructive" }))}
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {isRoot && (
        <AlertDialog
          open={uninstallDialogOpen}
          onOpenChange={setUninstallDialogOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("hub.uninstallPackTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("hub.uninstallPackDescription", {
                  name: installedPack?.name ?? node.name,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("hub.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className={cn(buttonVariants({ variant: "destructive" }))}
                disabled={uninstallPending}
                onClick={() => onUninstallPack?.(packId)}
              >
                {uninstallPending ? t("hub.uninstalling") : t("hub.uninstall")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {isRoot && canRename && (
        <RenamePackDialog
          open={renamePackDialogOpen}
          onOpenChange={setRenamePackDialogOpen}
          currentName={installedPack?.name ?? node.name}
          renaming={renamePackPending}
          onRename={(name) => {
            onRenamePack?.(packId, name);
            setRenamePackDialogOpen(false);
          }}
        />
      )}

      {isRoot && canEdit && installedPack && (
        <PackPublishDialogController
          pack={installedPack}
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
        />
      )}

      {isRoot && (
        <PackDetailsDialog
          open={detailsDialogOpen}
          onOpenChange={setDetailsDialogOpen}
          name={installedPack?.name ?? node.name}
          description={installedPack?.description ?? ""}
          version={installedPack?.version}
          packId={packId}
          fromHub={installedPack?.origin === "registry"}
        />
      )}
    </>
  );

  return (
    <div>
      {wrapped}
      <AnimatePresence initial={false}>
        {isFolder && open && (node.children || creatingChild) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {creatingChild && (
              <InlineCreateRow
                depth={depth + 1}
                kind={creatingChild}
                onCancel={() => setCreatingChild(null)}
                onSubmit={(name) => submitCreate(creatingChild, name)}
              />
            )}
            {node.children?.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                forceOpen={forceOpen}
                packActive={packActive}
                canEdit={canEdit}
                packId={packId}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PackRootTreeItem({
  node,
  canEdit,
  canRename,
  packId,
  installedPack,
  forceOpen,
  packActive,
  setActivePending,
  onSetActive,
  authenticated,
  onSignIn,
  onExport,
  exportPending,
  onUninstallPack,
  uninstallPending,
  onRenamePack,
  renamePackPending,
}: {
  node: TreeNode;
  canEdit: boolean;
  canRename: boolean;
  packId: string;
  installedPack?: InstalledPack;
  forceOpen: boolean;
  packActive: boolean;
  setActivePending: boolean;
  onSetActive: (active: boolean) => void;
  authenticated: boolean;
  onSignIn: () => void;
  onExport: (packId: string) => void;
  exportPending: boolean;
  onUninstallPack: (packId: string) => void;
  uninstallPending: boolean;
  onRenamePack: (packId: string, name: string) => void;
  renamePackPending: boolean;
}) {
  return (
    <TreeItem
      node={node}
      forceOpen={forceOpen}
      packActive={packActive}
      canEdit={canEdit}
      canRename={canRename}
      packId={packId}
      installedPack={installedPack}
      setActivePending={setActivePending}
      onSetActive={onSetActive}
      authenticated={authenticated}
      onSignIn={onSignIn}
      onExport={onExport}
      exportPending={exportPending}
      onUninstallPack={onUninstallPack}
      uninstallPending={uninstallPending}
      onRenamePack={onRenamePack}
      renamePackPending={renamePackPending}
    />
  );
}

export function PackSection({
  title,
  nodes,
  packActive,
  search,
  forceOpen,
  onSetActive,
  setActivePending,
  byPath,
  hubUser,
  collapsible = false,
  accordionValue,
  onAccordionChange,
  resetKey = 0,
  authenticated,
  onSignIn,
  onExport,
  exportPending,
  onUninstallPack,
  uninstallPending,
  onRenamePack,
  renamePackPending,
}: {
  title: string;
  nodes: TreeNode[];
  packActive: boolean;
  search: string;
  forceOpen: boolean;
  onSetActive: (packPath: string, active: boolean) => void;
  setActivePending: boolean;
  byPath: Map<string, InstalledPack>;
  hubUser: HubUser | null;
  /** When true, section body expands/collapses via accordion. */
  collapsible?: boolean;
  accordionValue?: string;
  onAccordionChange?: (value: string) => void;
  /** Bumping this remounts every root TreeItem, collapsing any expanded folders. */
  resetKey?: number;
  authenticated: boolean;
  onSignIn: () => void;
  onExport: (packId: string) => void;
  exportPending: boolean;
  onUninstallPack: (packId: string) => void;
  uninstallPending: boolean;
  onRenamePack: (packId: string, name: string) => void;
  renamePackPending: boolean;
}) {
  const filtered = useMemo(() => filterTree(nodes, search), [nodes, search]);
  if (filtered.length === 0) return null;

  const body = (
    <div className={cn("pb-2", !packActive && "opacity-90")}>
      {filtered.map((node) => {
        const installedPack = byPath.get(node.path);
        const canEdit = installedPack
          ? canEditPack(installedPack, hubUser)
          : false;
        const canRename = installedPack ? canRenamePack(installedPack) : false;
        const packId = installedPack?.pack_id ?? node.path;
        return (
          <PackRootTreeItem
            key={`${node.path}:${resetKey}`}
            node={node}
            forceOpen={forceOpen}
            packActive={packActive}
            canEdit={canEdit}
            canRename={canRename}
            packId={packId}
            installedPack={installedPack}
            setActivePending={setActivePending}
            onSetActive={(active) => onSetActive(node.path, active)}
            authenticated={authenticated}
            onSignIn={onSignIn}
            onExport={onExport}
            exportPending={exportPending}
            onUninstallPack={onUninstallPack}
            uninstallPending={uninstallPending}
            onRenamePack={onRenamePack}
            renamePackPending={renamePackPending}
          />
        );
      })}
    </div>
  );

  if (!collapsible) {
    return (
      <section className="space-y-1">
        <SectionLabel
          className={cn("px-3 pt-2", packActive && "text-foreground/70")}
        >
          {title}
        </SectionLabel>
        {body}
      </section>
    );
  }

  return (
    <Accordion
      type="single"
      collapsible
      value={accordionValue}
      onValueChange={onAccordionChange}
    >
      <AccordionItem value="inactive" className="border-b-0">
        <AccordionTrigger className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline">
          <span>
            {title}
            <span className="ml-1.5 font-normal normal-case tracking-normal opacity-70">
              ({filtered.length})
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-0">{body}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
