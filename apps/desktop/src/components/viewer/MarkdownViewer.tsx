import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { motion } from "motion/react";
import { Fragment } from "react";
import { api } from "@/lib/api";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";

export function MarkdownViewer({ path }: { path: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["file", path],
    queryFn: () => api.vaultReadFile(path),
  });

  const segments = path.split("/").filter(Boolean);
  const basePath = segments.slice(0, -1).join("/");

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        size="compact"
        actions={
          <Badge variant="muted">
            <Lock className="size-3" />
            Read-only
          </Badge>
        }
      >
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            {segments.map((segment, i) => (
              <Fragment key={i}>
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="min-w-0">
                  {i === segments.length - 1 ? (
                    <BreadcrumbPage>{segment}</BreadcrumbPage>
                  ) : (
                    <span className="truncate">{segment}</span>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
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
          {data && (
            <motion.div
              key={path}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <MarkdownBody basePath={basePath}>{data}</MarkdownBody>
            </motion.div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
