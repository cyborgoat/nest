import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { fileName } from "@/lib/vault-paths";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ImageViewer({ path }: { path: string }) {
  const name = fileName(path);
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.vaultImage(path),
    queryFn: () => api.vaultReadImage(path),
    staleTime: Infinity,
  });

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={name} description={path} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full items-center justify-center p-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading image…</p>
          ) : error || !data ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <ImageOff className="size-8" />
              <p>Image unavailable</p>
              <p className="max-w-sm text-center text-xs">
                {error instanceof Error ? error.message : path}
              </p>
            </div>
          ) : (
            <img
              src={data}
              alt={name}
              className="max-h-[calc(100vh-8rem)] max-w-full object-contain"
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
