import type { TreeNode } from "@nest/shared";
import { useQuery } from "@tanstack/react-query";
import { FileText, Folder } from "lucide-react";
import { Fragment } from "react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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

export function MarkdownPathBreadcrumb({ path }: { path: string }) {
  const { data: tree } = useQuery({
    queryKey: queryKeys.tree,
    queryFn: api.vaultListTree,
  });
  const openFileTab = useUiStore((s) => s.openFileTab);
  const segments = path.split("/").filter(Boolean);
  const basePath = segments.slice(0, -1).join("/");

  return (
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
              className={cn(
                "truncate",
                hasListing && "cursor-pointer hover:text-foreground",
              )}
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
                        onSelectFile={openFileTab}
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
  );
}
