import type { InstalledPack, TreeNode } from "@nest/shared";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
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

function TreeItem({
  node,
  depth = 0,
  forceOpen,
  packActive,
  onSetActive,
  setActivePending,
}: {
  node: TreeNode;
  depth?: number;
  forceOpen?: boolean;
  packActive: boolean;
  onSetActive?: (active: boolean) => void;
  setActivePending?: boolean;
}) {
  const [open, setOpen] = useState(depth < 1 || !!forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const selectedPath = useUiStore((s) => s.selectedPath);
  const setSelectedPath = useUiStore((s) => s.setSelectedPath);
  const isFolder = node.kind === "folder";
  const isRoot = depth === 0 && isFolder;
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md pr-1 text-sm transition-colors",
          isSelected ? "bg-primary/10 text-foreground" : "hover:bg-muted/80",
          !packActive && "text-muted-foreground",
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
          onClick={() => {
            if (isFolder) setOpen((v) => !v);
            else setSelectedPath(node.path);
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
          {isFolder ? (
            <Folder
              className={cn(
                "size-3.5 shrink-0",
                packActive ? "text-accent" : "text-muted-foreground",
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
          <span className={cn("truncate", !packActive && "opacity-80")}>
            {node.name}
          </span>
        </button>

        {isRoot && onSetActive && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
            title={packActive ? "Deactivate pack" : "Activate pack"}
            disabled={setActivePending}
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
        )}
      </div>
      <AnimatePresence initial={false}>
        {isFolder && open && node.children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                forceOpen={forceOpen}
                packActive={packActive}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
  collapsible = false,
  accordionValue,
  onAccordionChange,
}: {
  title: string;
  nodes: TreeNode[];
  packActive: boolean;
  search: string;
  forceOpen: boolean;
  onSetActive: (packPath: string, active: boolean) => void;
  setActivePending: boolean;
  /** When true, section body expands/collapses via accordion. */
  collapsible?: boolean;
  accordionValue?: string;
  onAccordionChange?: (value: string) => void;
}) {
  const filtered = useMemo(() => filterTree(nodes, search), [nodes, search]);
  if (filtered.length === 0) return null;

  const body = (
    <div className={cn("pb-2", !packActive && "opacity-90")}>
      {filtered.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          forceOpen={forceOpen}
          packActive={packActive}
          setActivePending={setActivePending}
          onSetActive={(active) => onSetActive(node.path, active)}
        />
      ))}
    </div>
  );

  if (!collapsible) {
    return (
      <section className="space-y-1">
        <h3
          className={cn(
            "px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide",
            packActive ? "text-foreground/70" : "text-muted-foreground",
          )}
        >
          {title}
        </h3>
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
      className="border-t border-border"
    >
      <AccordionItem value="inactive" className="border-b-0">
        <AccordionTrigger className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:no-underline">
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
  const queryClient = useQueryClient();
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);

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
      queryClient.invalidateQueries({ queryKey: ["installed-packs"] });
      toast.success(vars.active ? "Pack activated" : "Pack deactivated", {
        description: vars.packId,
      });
    },
    onError: (e: Error) =>
      toast.error("Could not update pack", { description: e.message }),
  });

  if (tree.length === 0) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <p className="text-sm font-medium text-foreground">No packs yet</p>
        <p className="text-sm text-muted-foreground">
          Download from the Hub to add knowledge packs.
        </p>
      </div>
    );
  }

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-2 py-2">
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
          collapsible
          accordionValue={inactiveOpen}
          onAccordionChange={setInactiveOpen}
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

/** Flatten folders + md files under active pack roots for @ mentions. */
export function collectMentionCandidates(
  tree: TreeNode[],
  activeRoots: string[],
): { path: string; kind: "file" | "folder"; name: string }[] {
  if (activeRoots.length === 0) return [];
  const roots = new Set(activeRoots);
  const out: { path: string; kind: "file" | "folder"; name: string }[] = [];

  const walkUnder = (node: TreeNode) => {
    if (node.kind === "folder") {
      out.push({ path: node.path, kind: "folder", name: node.name });
      for (const child of node.children ?? []) {
        walkUnder(child);
      }
    } else if (node.name.toLowerCase().endsWith(".md")) {
      out.push({ path: node.path, kind: "file", name: node.name });
    }
  };

  for (const root of tree) {
    if (root.kind === "folder" && roots.has(root.path)) {
      for (const child of root.children ?? []) {
        walkUnder(child);
      }
    }
  }
  return out;
}
