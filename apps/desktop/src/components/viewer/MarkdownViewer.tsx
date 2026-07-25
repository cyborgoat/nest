import type { TreeNode } from "@nest/shared";
import { useQuery } from "@tanstack/react-query";
import { FileText, Folder, Lock, Pencil } from "lucide-react";
import { motion } from "motion/react";
import { Fragment, useMemo } from "react";
import { api } from "@/lib/api";
import { parseFrontmatter } from "@/lib/frontmatter";
import { canEditPack } from "@/lib/pack-permissions";
import { queryKeys } from "@/lib/query-keys";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { MarkdownFrontmatter } from "@/components/markdown/MarkdownFrontmatter";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor";
import { useUiStore } from "@/stores/ui";

function childrenAtPath(nodes: TreeNode[], targetPath: string): TreeNode[] {
  if (!targetPath) return nodes;
  const segs = targetPath.split("/").filter(Boolean);
  let current = nodes;
  for (let i = 0; i < segs.length; i++) {
    const cumulative = segs.slice(0, i + 1).join("/");
    const match = current.find((n) => n.path === cumulative);
    if (!match) return [];
    current = match.children ?? [];
  }
  return current;
}

function BreadcrumbMenuItems({
  nodes,
  activePath,
  onSelectFile,
}: {
  nodes: TreeNode[];
  activePath: string | null;
  onSelectFile: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <DropdownMenuSub key={node.path}>
            <DropdownMenuSubTrigger>
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{node.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <BreadcrumbMenuItems
                nodes={node.children ?? []}
                activePath={activePath}
                onSelectFile={onSelectFile}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <DropdownMenuItem
            key={node.path}
            className={cn(node.path === activePath && "bg-muted font-medium")}
            onSelect={() => onSelectFile(node.path)}
          >
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{node.name}</span>
          </DropdownMenuItem>
        ),
      )}
    </>
  );
}

export function MarkdownViewer({ path }: { path: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.file(path),
    queryFn: () => api.vaultReadFile(path),
  });
  const { data: tree } = useQuery({
    queryKey: queryKeys.tree,
    queryFn: api.vaultListTree,
  });
  const openFileTab = useUiStore((s) => s.openFileTab);
  const setEditing = useEditorStore((s) => s.setEditing);

  const segments = path.split("/").filter(Boolean);
  const basePath = segments.slice(0, -1).join("/");
  const rootPath = segments[0] ?? "";

  const { data: installed } = useQuery({
    queryKey: queryKeys.installedPacks,
    queryFn: api.hubListInstalled,
  });
  const { data: hubAuth } = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const pack = installed?.find((p) => p.local_path === rootPath);
  const canEdit = pack ? canEditPack(pack, hubAuth?.user ?? null) : false;

  const { frontmatter, body } = useMemo(() => {
    if (data == null) return { frontmatter: null, body: data };
    const parsed = parseFrontmatter(data);
    return { frontmatter: parsed.data, body: parsed.content };
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        size="compact"
        actions={
          canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(path, true)}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
          ) : (
            <Badge variant="muted">
              <Lock className="size-3" />
              Read-only
            </Badge>
          )
        }
      >
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            {segments.map((segment, i) => {
              const isLast = i === segments.length - 1;
              const folderPath = isLast
                ? basePath
                : segments.slice(0, i + 1).join("/");
              const listing = tree ? childrenAtPath(tree, folderPath) : [];
              const hasListing = listing.length > 0;

              const label = isLast ? (
                <BreadcrumbPage className={cn(hasListing && "cursor-pointer")}>
                  {segment}
                </BreadcrumbPage>
              ) : (
                <span
                  className={cn("truncate", hasListing && "cursor-pointer hover:text-foreground")}
                >
                  {segment}
                </span>
              );

              return (
                <Fragment key={i}>
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem className="min-w-0">
                    {hasListing ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>{label}</DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <BreadcrumbMenuItems
                            nodes={listing}
                            activePath={path}
                            onSelectFile={(p) => openFileTab(p)}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      label
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </PanelHeader>
      <ScrollArea className="flex-1">
        <div className="max-w-3xl px-6 py-5">
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {error && (
            <p className="text-destructive">
              {(error as Error).message || "Failed to load file"}
            </p>
          )}
          {body != null && (
            <motion.div
              key={path}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {frontmatter && (
                <MarkdownFrontmatter data={frontmatter} basePath={basePath} />
              )}
              <MarkdownBody basePath={basePath}>{body}</MarkdownBody>
            </motion.div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
