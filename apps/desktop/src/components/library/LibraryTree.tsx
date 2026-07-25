import type {
  FileChangeStatus,
  HubUser,
  InstalledPack,
  TreeNode,
} from "@nest/shared";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  Minus,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
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
import { api } from "@/lib/api";
import {
  STATUS_BADGE_VARIANT,
  STATUS_LETTER,
  STATUS_TEXT_CLASSES,
} from "@/lib/file-status-ui";
import { mergeDeletedIntoTree } from "@/lib/merge-deleted-tree";
import { canEditPack } from "@/lib/pack-permissions";
import { fileMutationInvalidations, queryKeys } from "@/lib/query-keys";
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
  packId,
  origin,
  statusMap,
  onSetActive,
  setActivePending,
}: {
  node: TreeNode;
  depth?: number;
  forceOpen?: boolean;
  packActive: boolean;
  canEdit: boolean;
  packId: string;
  origin?: InstalledPack["origin"];
  statusMap: Map<string, FileChangeStatus>;
  onSetActive?: (active: boolean) => void;
  setActivePending?: boolean;
}) {
  const [open, setOpen] = useState(!!forceOpen);
  const [renaming, setRenaming] = useState(false);
  const [creatingChild, setCreatingChild] = useState<"file" | "folder" | null>(
    null,
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

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
  // Packs downloaded from the hub get a distinct stroke color in the tree.
  const rootIconClass = origin === "registry" ? "text-sky-500" : undefined;

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

  const row = (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md pr-1 text-sm transition-colors",
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
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
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

  const wrapped = editableHere ? (
    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {isFolder && (
            <>
              <ContextMenuItem onSelect={() => startCreate("file")}>
                <FilePlus2 className="size-3.5" />
                New File
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => startCreate("folder")}>
                <FolderPlus className="size-3.5" />
                New Folder
              </ContextMenuItem>
            </>
          )}
          {!isRoot && (
            <>
              {isFolder && <ContextMenuSeparator />}
              <ContextMenuItem onSelect={startRename}>
                <Pencil className="size-3.5" />
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  window.setTimeout(() => setDeleteDialogOpen(true), 0);
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
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
  ) : (
    row
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
  packId,
  origin,
  forceOpen,
  packActive,
  setActivePending,
  onSetActive,
}: {
  node: TreeNode;
  canEdit: boolean;
  packId: string;
  origin?: InstalledPack["origin"];
  forceOpen: boolean;
  packActive: boolean;
  setActivePending: boolean;
  onSetActive: (active: boolean) => void;
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
      packId={packId}
      origin={origin}
      statusMap={statusMap}
      setActivePending={setActivePending}
      onSetActive={onSetActive}
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
        const packId = installedPack?.pack_id ?? node.path;
        return (
          <PackRootTreeItem
            key={`${node.path}:${resetKey}`}
            node={node}
            forceOpen={forceOpen}
            packActive={packActive}
            canEdit={canEdit}
            packId={packId}
            origin={installedPack?.origin}
            setActivePending={setActivePending}
            onSetActive={(active) => onSetActive(node.path, active)}
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
  const [search, setSearch] = useState("");
  const [inactiveOpen, setInactiveOpen] = useState("");
  const [inactiveResetKey, setInactiveResetKey] = useState(0);
  const queryClient = useQueryClient();
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);

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
