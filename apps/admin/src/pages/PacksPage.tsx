import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Eye,
  EyeOff,
  Package,
  Search,
  Upload,
} from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/InputGroup";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "../components/Item";
import { UploadPackDialog } from "../components/UploadPackDialog";
import { RegistryResyncNotice } from "../components/RegistryResyncNotice";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  RefreshButton,
  Skeleton,
} from "../components/ui";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { useAdminPacks, useRegistryResync } from "../lib/hooks";
import { cn } from "../lib/cn";
import { PageHeader } from "../layout/PageHeader";

type StatusFilter = "all" | "active" | "archived" | "restricted";

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: "All",
  active: "Active",
  restricted: "Restricted",
  archived: "Archived",
};

export function PacksPage() {
  const api = useApi();
  const qc = useQueryClient();
  const packs = useAdminPacks();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const resync = useRegistryResync();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api("/api/admin/packs/upload", { method: "POST", body });
    },
    onSuccess: () => {
      setUploadOpen(false);
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
      void qc.invalidateQueries({ queryKey: adminQueryKeys.reviews });
    },
  });

  const counts = useMemo(() => {
    const all = packs.data ?? [];
    return {
      all: all.length,
      active: all.filter((pack) => !pack.archived).length,
      archived: all.filter((pack) => pack.archived).length,
      restricted: all.filter((pack) => pack.visibility === "restricted").length,
    };
  }, [packs.data]);

  const normalizedSearch = search.trim().toLowerCase();
  const shown = (packs.data ?? [])
    .filter((pack) =>
      `${pack.id} ${pack.name} ${pack.description} ${pack.maintainers
        .map((maintainer) => maintainer.name)
        .join(" ")}`
        .toLowerCase()
        .includes(normalizedSearch),
    )
    .filter((pack) => {
      if (statusFilter === "active") return !pack.archived;
      if (statusFilter === "archived") return pack.archived;
      if (statusFilter === "restricted")
        return pack.visibility === "restricted";
      return true;
    });

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Knowledge packs"
        description="Find a pack, then open its details to manage versions, access, maintainers, and lifecycle."
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton
              onClick={() => resync.mutate()}
              busy={resync.isPending || packs.isFetching}
              label="Resync with registry folder"
            />
            <Button onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" />
              Upload pack
            </Button>
          </div>
        }
      />
      {(packs.error || resync.error) && (
        <ErrorBox error={packs.error || resync.error} />
      )}
      <RegistryResyncNotice result={resync.data} />
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <InputGroup className="w-full lg:max-w-md">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search packs"
              placeholder="Search by name, ID, description, or maintainer…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
          <div
            className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 lg:w-auto"
            aria-label="Filter packs"
          >
            {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                  statusFilter === filter
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {FILTER_LABELS[filter]}
                <span className="tabular-nums opacity-60">
                  {counts[filter]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {packs.isLoading && !packs.data ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 px-3 py-4">
                <Skeleton className="size-10 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <Empty
            compact
            title="No packs found"
            body={
              search || statusFilter !== "all"
                ? "Try a different search or filter."
                : "Upload a pack to start building the catalog."
            }
          />
        ) : (
          <ItemGroup className="divide-y divide-border p-2">
            {shown.map((pack) => {
              const [firstMaintainer, ...otherMaintainers] = pack.maintainers;
              const maintainer = firstMaintainer
                ? otherMaintainers.length > 0
                  ? `${firstMaintainer.name} +${otherMaintainers.length}`
                  : firstMaintainer.name
                : "Unassigned";
              return (
                <Link
                  key={pack.id}
                  to="/packs/$packId"
                  params={{ packId: pack.id }}
                  className="group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <Item className="group-hover:bg-muted/70">
                    <ItemMedia className="group-hover:bg-card group-hover:text-primary">
                      <Package />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="flex flex-wrap items-center gap-2">
                        <span className="truncate">{pack.name}</span>
                        <Badge
                          tone={
                            pack.visibility === "restricted" ? "amber" : "green"
                          }
                        >
                          {pack.visibility === "restricted" ? (
                            <EyeOff />
                          ) : (
                            <Eye />
                          )}
                          {pack.visibility}
                        </Badge>
                        {pack.archived && <Badge tone="stone">Archived</Badge>}
                      </ItemTitle>
                      <ItemDescription className="mt-1 line-clamp-1">
                        {pack.description || "No description provided."}
                      </ItemDescription>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-mono">{pack.id}</span>
                        <span aria-hidden="true"> · </span>
                        Maintainer: {maintainer}
                      </p>
                    </ItemContent>
                    <ItemActions>
                      <div className="hidden min-w-24 text-right sm:block">
                        <p className="font-mono text-xs font-medium text-foreground">
                          {pack.latest_version
                            ? `v${pack.latest_version}`
                            : "No version"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {pack.releases.length} release
                          {pack.releases.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </ItemActions>
                  </Item>
                </Link>
              );
            })}
          </ItemGroup>
        )}
      </Card>
      <UploadPackDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        busy={upload.isPending}
        error={upload.error}
        onUpload={(file) => upload.mutate(file)}
      />
    </>
  );
}
