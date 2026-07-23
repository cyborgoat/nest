import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const EXTERNAL_SRC = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

function resolveVaultAssetPath(baseDir: string, ref: string): string {
  if (ref.startsWith("/")) return ref.slice(1);
  const stack = baseDir ? baseDir.split("/") : [];
  for (const part of ref.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

type Props = {
  src?: string;
  alt?: string;
  baseDir: string;
};

export function VaultImage({ src, alt, baseDir }: Props) {
  const external = !src || EXTERNAL_SRC.test(src);
  const resolved = external ? "" : resolveVaultAssetPath(baseDir, src);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.vaultImage(resolved),
    queryFn: () => api.vaultReadImage(resolved),
    enabled: !external && !!resolved,
    staleTime: Infinity,
  });

  if (external) return <img src={src} alt={alt ?? ""} />;

  if (isLoading) {
    return (
      <span className="inline-flex h-24 w-full items-center justify-center rounded-lg border border-border/60 bg-foreground/5 text-xs text-muted-foreground">
        Loading image…
      </span>
    );
  }

  if (error || !data) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-foreground/5 px-2 py-1.5 text-xs text-muted-foreground"
        title={src}
      >
        <ImageOff className="size-3.5 shrink-0" />
        Image unavailable{alt ? `: ${alt}` : ""}
      </span>
    );
  }

  return <img src={data} alt={alt ?? ""} />;
}
