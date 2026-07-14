import type { TreeNode } from "@nest/shared";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const selectedPath = useUiStore((s) => s.selectedPath);
  const selectedScope = useUiStore((s) => s.selectedScope);
  const setSelectedPath = useUiStore((s) => s.setSelectedPath);
  const toggleScope = useUiStore((s) => s.toggleScope);
  const isFolder = node.kind === "folder";
  const isSelected = selectedPath === node.path;
  const inScope = selectedScope.includes(node.path);

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md pr-2 text-sm transition-colors",
          isSelected ? "bg-primary/10 text-foreground" : "hover:bg-muted/80",
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
            <Folder className="size-3.5 shrink-0 text-accent" />
          ) : (
            <FileText className="size-3.5 shrink-0 text-primary" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        <button
          type="button"
          title="Toggle chat scope"
          onClick={() => toggleScope(node.path)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-0 transition group-hover:opacity-100",
            inScope
              ? "bg-accent text-accent-foreground opacity-100"
              : "bg-muted text-muted-foreground",
          )}
        >
          {inScope ? "scoped" : "scope"}
        </button>
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
              <TreeItem key={child.path} node={child} depth={depth + 1} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function LibraryTree({ tree }: { tree: TreeNode[] }) {
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

  return (
    <div className="py-2">
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} />
      ))}
    </div>
  );
}
