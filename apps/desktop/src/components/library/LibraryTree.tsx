import type {
  FileChangeStatus,
  HubUser,
  InstalledPack,
  PackProject,
  TreeNode,
} from "@nest/shared";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Info,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { PackDetailsDialog } from "@/components/hub/PackDetailsDialog";
import { PublishPackDialog } from "@/components/hub/PublishPackDialog";
import { RenamePackDialog } from "@/components/hub/RenamePackDialog";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LETTER,
  STATUS_TEXT_CLASSES,
} from "@/lib/file-status-ui";
import { useI18n } from "@/lib/i18n";
import { mergeDeletedIntoTree } from "@/lib/merge-deleted-tree";
import { canEditPack, canRenamePack } from "@/lib/pack-permissions";
import {
  fileMutationInvalidations,
  packMutationInvalidations,
  queryKeys,
} from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor";
import { useUiStore } from "@/stores/ui";

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
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

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function ensureMdExtension(name: string): string {
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
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
    <ContextMenuItem disabled={disabled} className={className} onSelect={onSelect}>
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
  statusMap,
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
  onPublish,
  publishPending,
}: {
  node: TreeNode;
  depth?: number;
  forceOpen?: boolean;
  packActive: boolean;
  canEdit: boolean;
  canRename?: boolean;
  packId: string;
  installedPack?: InstalledPack;
  statusMap: Map<string, FileChangeStatus>;
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
  onPublish?: (packId: string, version: string, description: string) => void;
  publishPending?: boolean;
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
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const { t } = useI18n();
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const openFileTab = useUiStore((s) => s.openFileTab);
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const setEditing = useEditorStore((s) => s.setEditing);
  const setDirty = useEditorStore((s) => s.setDirty);
  const queryClient = useQueryClient();
  const isFolder = node.kind === "folder";
  const isRoot = depth === 0 && isFolder;
  const isSelected = activeMainTabId === node.path;
  const status = statusMap.get(node.path);
  const isDeleted = status === "deleted";
  const editableHere = canEdit && !isDeleted;
  const editReason = isDeleted
    ? "This file has already been deleted."
    : !canEdit
      ? "You don't have edit access to this pack."
      : undefined;
  const renameReason = canRename
    ? undefined
    : "Only local packs can be renamed.";
  const publishLocked = Boolean(installedPack?.pending_version);
  const publishReason = !canEdit
    ? "You don't have edit access to this pack."
    : publishLocked
      ? `v${installedPack?.pending_version} is already awaiting review.`
      : undefined;
  const origin = installedPack?.origin;
  // Packs downloaded from the hub get a distinct stroke color in the tree.
  const rootIconClass = origin === "registry" ? "text-info" : undefined;

  const catalogQuery = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.hubListPacks,
    enabled: isRoot && canEdit && publishDialogOpen,
    retry: 1,
  });
  const isFirstPublish = !catalogQuery.data?.some(
    (p: PackProject) => p.id === packId,
  );

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
        openFileTab(joinPath(node.path, ensureMdExtension(vars.name)), {
          preview: false,
        });
      } else {
        // Empty folders are hidden from the tree until they contain a file,
        // so the new folder won't be visible yet — tell the user why.
        toast.success("Folder created", {
          description: "It appears in the tree once it has a file in it.",
        });
      }
    },
    onError: (e: Error) =>
      toast.error("Could not create item", { description: e.message }),
  });

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
    onError: (e: Error) =>
      toast.error("Could not rename", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: () =>
      isFolder ? api.vaultDeleteFolder(node.path) : api.vaultDeleteFile(node.path),
    onSuccess: () => {
      clearPathsUnder(node.path);
      setEditing(node.path, false);
      setDirty(node.path, false);
      invalidateAfterEdit();
    },
    onError: (e: Error) =>
      toast.error("Could not delete", { description: e.message }),
  });

  const startRename = () => setRenaming(true);
  const startCreate = (kind: "file" | "folder") => {
    setOpen(true);
    setCreatingChild(kind);
  };
  const submitRename = (rawName: string) => {
    setRenaming(false);
    const name = isFolder ? rawName : ensureMdExtension(rawName);
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
      className="flex min-w-0 flex-1 select-none items-center gap-1.5 py-1.5 text-left"
      onClick={() => {
        if (isFolder) setOpen((v) => !v);
        else if (!isDeleted) openFileTab(node.path);
      }}
      onDoubleClick={() => {
        if (!isFolder && !isDeleted) openFileTab(node.path, { preview: false });
      }}
    >
      {isFolder ? (
        open ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )
      ) : (
        <span className="inline-block w-3.5" />
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
          "truncate",
          !packActive && "opacity-80",
          status && STATUS_TEXT_CLASSES[status],
        )}
      >
        {node.name}
      </span>
      {status && (
        <Badge
          variant={STATUS_BADGE_VARIANT[status]}
          className="ml-auto shrink-0 px-1 py-0 text-[10px] leading-4"
        >
          {STATUS_LETTER[status]}
        </Badge>
      )}
    </button>
  );

  const row = (
    <div
      className={cn(
        "group flex select-none items-center gap-1 rounded-md pr-1 text-sm transition-colors",
        isSelected ? "bg-primary/10 text-foreground" : "hover:bg-muted/80",
        !packActive && "text-muted-foreground",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
    >
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
          <span className="inline-block w-3.5" />
          {isRoot ? (
            <Package
              className={cn("size-3.5 shrink-0", rootIconClass ?? "text-primary")}
            />
          ) : isFolder ? (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Input
            autoFocus
            defaultValue={node.name}
            className="h-6 flex-1 px-1.5 text-xs"
            onFocus={(e) => {
              const dot = node.name.lastIndexOf(".");
              e.currentTarget.setSelectionRange(0, dot > 0 ? dot : node.name.length);
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
            onBlur={(e) => submitRename(e.currentTarget.value.trim() || node.name)}
          />
        </div>
      ) : (
        nameButton
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
            </>
          )}
          {!isRoot && (
            <>
              {isFolder && <ContextMenuSeparator />}
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
                onSelect={() => {
                  window.setTimeout(() => setDeleteDialogOpen(true), 0);
                }}
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
              <ContextMenuItem onSelect={() => setDetailsDialogOpen(true)}>
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
                onSelect={() => onExport?.(packId)}
              >
                <Download className="size-3.5" />
                Export ZIP
              </ContextMenuItem>
              <PermissionMenuItem
                disabled={!canRename}
                reason={renameReason}
                onSelect={() => {
                  window.setTimeout(() => setRenamePackDialogOpen(true), 0);
                }}
              >
                <Pencil className="size-3.5" />
                Rename pack
              </PermissionMenuItem>
              <PermissionMenuItem
                disabled={!canEdit || publishLocked}
                reason={publishReason}
                onSelect={() => {
                  window.setTimeout(() => {
                    if (authenticated) setPublishDialogOpen(true);
                    else onSignIn?.();
                  }, 0);
                }}
              >
                <Send className="size-3.5" />
                {canEdit && !authenticated ? "Sign in to publish" : "Publish"}
              </PermissionMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  window.setTimeout(() => setUninstallDialogOpen(true), 0);
                }}
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

      {isRoot && canEdit && (
        <PublishPackDialog
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          packName={installedPack?.name ?? node.name}
          currentVersion={installedPack?.version ?? ""}
          currentDescription={installedPack?.description ?? ""}
          isFirstPublish={isFirstPublish}
          publishing={publishPending}
          lockedPendingVersion={installedPack?.pending_version}
          onPublish={(version, description) => {
            onPublish?.(packId, version, description);
            setPublishDialogOpen(false);
          }}
        />
      )}

      {isRoot && (
        <PackDetailsDialog
          open={detailsDialogOpen}
          onOpenChange={setDetailsDialogOpen}
          name={installedPack?.name ?? node.name}
          description={installedPack?.description ?? ""}
          version={installedPack?.version}
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
                statusMap={statusMap}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Fetches a pack's change status once per root and merges deleted files into
 * the tree, so `TreeItem`'s recursion never needs N queries for N files. */
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
  onPublish,
  publishPending,
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
  onPublish: (packId: string, version: string, description: string) => void;
  publishPending: boolean;
}) {
  const statusQuery = useQuery({
    queryKey: queryKeys.packStatus(packId),
    queryFn: () => api.hubPackChangeStatus(packId),
    enabled: canEdit,
  });

  const statusMap = useMemo(() => {
    const map = new Map<string, FileChangeStatus>();
    for (const s of statusQuery.data ?? []) map.set(s.path, s.status);
    return map;
  }, [statusQuery.data]);

  const deletedPaths = useMemo(
    () => (statusQuery.data ?? []).filter((s) => s.status === "deleted").map((s) => s.path),
    [statusQuery.data],
  );
  const mergedNode = useMemo(
    () => mergeDeletedIntoTree(node, deletedPaths),
    [node, deletedPaths],
  );

  return (
    <TreeItem
      node={mergedNode}
      forceOpen={forceOpen}
      packActive={packActive}
      canEdit={canEdit}
      canRename={canRename}
      packId={packId}
      installedPack={installedPack}
      statusMap={statusMap}
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
      onPublish={onPublish}
      publishPending={publishPending}
    />
  );
}

function PackSection({
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
  onPublish,
  publishPending,
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
  onPublish: (packId: string, version: string, description: string) => void;
  publishPending: boolean;
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
            onPublish={onPublish}
            publishPending={publishPending}
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

export function LibraryTree({
  tree,
  installed,
}: {
  tree: TreeNode[];
  installed: InstalledPack[];
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [inactiveOpen, setInactiveOpen] = useState("");
  const [inactiveResetKey, setInactiveResetKey] = useState(0);
  const queryClient = useQueryClient();
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const openAccountSettingsTab = useUiStore((s) => s.openAccountSettingsTab);

  const hubAuthQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const hubUser = hubAuthQuery.data?.user ?? null;
  const authenticated = hubAuthQuery.data?.authenticated ?? false;

  const byPath = useMemo(() => {
    const map = new Map<string, InstalledPack>();
    for (const p of installed) {
      map.set(p.local_path, p);
      map.set(p.pack_id, p);
    }
    return map;
  }, [installed]);

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
      toast.success(vars.active ? "Knowledge pack activated" : "Knowledge pack deactivated");
    },
    onError: (e: Error) =>
      toast.error("Could not update pack", { description: e.message }),
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
    onError: (e: Error) =>
      toast.error(t("hub.exportFailed"), { description: e.message }),
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
    onError: (e: Error) =>
      toast.error(t("hub.removeFailed"), { description: e.message }),
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

  const publishPack = useMutation({
    mutationFn: async ({
      packId,
      version,
      description,
    }: {
      packId: string;
      version: string;
      description: string;
    }) => {
      await api.hubUpdatePackMetadata(packId, description);
      return api.hubPublishPack(packId, version);
    },
    onSuccess: (_data, vars) => {
      toast.success("Pack submitted for administrator review");
      void queryClient.invalidateQueries({ queryKey: queryKeys.publishRequests });
      void queryClient.invalidateQueries({ queryKey: queryKeys.installedPacks });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.packStatus(vars.packId),
      });
    },
    onError: (error: unknown) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hubAuth });
      toast.error(appErrorMessage(error, "Could not publish pack"));
    },
  });

  const handleExport = async (packId: string) => {
    const pack = byPath.get(packId);
    const destination = await save({
      title: t("hub.exportKnowledgePack"),
      defaultPath: pack ? `${pack.pack_id}-${pack.version}.zip` : `${packId}.zip`,
      filters: [{ name: "Knowledge pack", extensions: ["zip"] }],
    });
    if (destination) exportPack.mutate({ packId, destinationPath: destination });
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

  if (tree.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <p className="text-sm font-medium text-foreground">No packs yet</p>
        <p className="text-sm text-muted-foreground">
          Download from Hub to add knowledge packs.
        </p>
      </div>
    );
  }

  return (
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
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
            const packId = byPath.get(packPath)?.pack_id ?? packPath;
            setActive.mutate({ packId, active });
          }}
          authenticated={authenticated}
          onSignIn={openAccountSettingsTab}
          onExport={handleExport}
          exportPending={exportPack.isPending}
          onUninstallPack={(packId) => uninstallPack.mutate(packId)}
          uninstallPending={uninstallPack.isPending}
          onRenamePack={(packId, name) => renamePack.mutate({ packId, name })}
          renamePackPending={renamePack.isPending}
          onPublish={(packId, version, description) =>
            publishPack.mutate({ packId, version, description })
          }
          publishPending={publishPack.isPending}
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
            const packId = byPath.get(packPath)?.pack_id ?? packPath;
            setActive.mutate({ packId, active });
          }}
          authenticated={authenticated}
          onSignIn={openAccountSettingsTab}
          onExport={handleExport}
          exportPending={exportPack.isPending}
          onUninstallPack={(packId) => uninstallPack.mutate(packId)}
          uninstallPending={uninstallPack.isPending}
          onRenamePack={(packId, name) => renamePack.mutate({ packId, name })}
          renamePackPending={renamePack.isPending}
          onPublish={(packId, version, description) =>
            publishPack.mutate({ packId, version, description })
          }
          publishPending={publishPack.isPending}
        />
        {search.trim() &&
          filterTree(activeRoots, search).length === 0 &&
          inactiveMatches.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No matches.
            </p>
          )}
      </div>
    </div>
  );
}

/** Flatten active pack roots + their folders/md files for @ mentions. */
export function collectMentionCandidates(
  tree: TreeNode[],
  activeRoots: string[],
): { path: string; kind: "file" | "folder"; name: string }[] {
  if (activeRoots.length === 0) return [];
  const roots = new Set(activeRoots);
  const out: { path: string; kind: "file" | "folder"; name: string }[] = [];

  const walk = (node: TreeNode) => {
    if (node.kind === "folder") {
      out.push({ path: node.path, kind: "folder", name: node.name });
      for (const child of node.children ?? []) {
        walk(child);
      }
    } else if (node.name.toLowerCase().endsWith(".md")) {
      out.push({ path: node.path, kind: "file", name: node.name });
    }
  };

  for (const root of tree) {
    if (root.kind === "folder" && roots.has(root.path)) {
      walk(root);
    }
  }
  return out;
}
