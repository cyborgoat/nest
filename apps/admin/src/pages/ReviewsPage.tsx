import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, FileDiff, MoreHorizontal } from "lucide-react";
import type {
  AdminPublishHistoryPage,
  AdminPublishRequest,
  PendingPublishRequest as RequestItem,
} from "@nest/shared";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  RefreshButton,
  Select,
  Skeleton,
  formatDate,
} from "../components/ui";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { useAdminReviews } from "../lib/hooks";
import { PageHeader } from "../layout/PageHeader";

type ReviewTab = "queue" | "history";
type HistoryStatus = "all" | "approved" | "rejected";

export function ReviewsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const reviews = useAdminReviews();
  const [tab, setTab] = useState<ReviewTab>("queue");
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("all");
  const history = useInfiniteQuery({
    queryKey: adminQueryKeys.reviewHistoryFor(historyStatus),
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        status: historyStatus,
        limit: "50",
      });
      if (pageParam) params.set("cursor", pageParam);
      return api<AdminPublishHistoryPage>(
        `/api/admin/publish-requests/history?${params}`,
      );
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: tab === "history",
  });
  const historyItems = history.data?.pages.flatMap((page) => page.items) ?? [];

  const refresh = () =>
    tab === "queue"
      ? qc.invalidateQueries({ queryKey: adminQueryKeys.reviews })
      : qc.invalidateQueries({
          queryKey: adminQueryKeys.reviewHistoryFor(historyStatus),
        });

  return (
    <>
      <PageHeader
        eyebrow="Publishing"
        title="Publishing reviews"
        description="Inspect every changed file before releasing knowledge to the Hub."
        actions={
          <RefreshButton
            onClick={() => void refresh()}
            busy={tab === "queue" ? reviews.isFetching : history.isFetching}
          />
        }
      />
      <div className="mb-5 inline-flex rounded-lg border border-border bg-card p-1">
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
          Queue
          {reviews.data?.length ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
              {reviews.data.length}
            </span>
          ) : null}
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          History
        </TabButton>
      </div>

      {(reviews.error || history.error) && (
        <ErrorBox error={reviews.error || history.error} />
      )}
      {tab === "queue" ? (
        <Queue reviews={reviews.data} loading={reviews.isLoading} />
      ) : (
        <History
          items={historyItems}
          status={historyStatus}
          loading={history.isLoading}
          hasNextPage={history.hasNextPage}
          loadingMore={history.isFetchingNextPage}
          onStatusChange={(value) => setHistoryStatus(value as HistoryStatus)}
          onLoadMore={() => void history.fetchNextPage()}
        />
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Queue({
  reviews,
  loading,
}: {
  reviews: RequestItem[] | undefined;
  loading: boolean;
}) {
  if (loading)
    return (
      <Card className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </Card>
    );
  if (reviews?.length === 0)
    return (
      <Empty
        title="The queue is clear"
        body="New pack and version submissions will appear here."
      />
    );
  return (
    <Card className="p-0">
      <div className="divide-y divide-border">
        {reviews?.map((item) => (
          <div
            key={item.id}
            className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
          >
            <RequestSummary item={item} />
            <div className="flex shrink-0 items-center gap-2">
              <Link
                to="/reviews/$requestId"
                params={{ requestId: item.id }}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <FileDiff className="size-4" />
                Review changes
              </Link>
              <details className="group relative">
                <summary className="grid size-9 list-none place-items-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted">
                  <MoreHorizontal className="size-4" />
                  <span className="sr-only">More actions</span>
                </summary>
                <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-lg border border-border bg-card p-1 shadow-xl">
                  <a
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                    href={`/api/admin/publish-requests/${item.id}/download`}
                    download
                  >
                    <Download className="size-4" />
                    Download artifact
                  </a>
                </div>
              </details>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RequestSummary({ item }: { item: RequestItem }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.name}</span>
        <Badge>{item.pack_id}</Badge>
        <span className="text-sm text-muted-foreground">v{item.version}</span>
        {item.request_type === "live_patch" && (
          <Badge tone="amber">Live patch · Patch {item.patch_revision}</Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Submitted by{" "}
        <strong className="text-foreground">{item.submitter_name}</strong> · @
        {item.submitter_id} · {formatDate(item.created_at)} ·{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
          sha256 {item.checksum.slice(0, 14)}…
        </code>
      </p>
      <p className="mt-2 line-clamp-2 text-sm font-medium">
        {item.commit_message || "No publish commit message provided."}
      </p>
    </div>
  );
}

function History({
  items,
  status,
  loading,
  hasNextPage,
  loadingMore,
  onStatusChange,
  onLoadMore,
}: {
  items: AdminPublishRequest[];
  status: HistoryStatus;
  loading: boolean;
  hasNextPage: boolean;
  loadingMore: boolean;
  onStatusChange: (value: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select
          value={status}
          onValueChange={onStatusChange}
          options={[
            { value: "all", label: "All decisions" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
      </div>
      {loading ? (
        <Card className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </Card>
      ) : items.length === 0 ? (
        <Empty
          title="No review history"
          body="Completed approvals and rejections will appear here."
        />
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    <Badge>{item.pack_id}</Badge>
                    <span className="text-sm text-muted-foreground">
                      v{item.version}
                      {item.request_type === "live_patch"
                        ? ` · Patch ${item.patch_revision}`
                        : ""}
                    </span>
                    {item.request_type === "live_patch" && (
                      <Badge tone="amber">Live patch</Badge>
                    )}
                    <Badge tone={item.status === "approved" ? "green" : "red"}>
                      {item.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reviewed by {identity(item.reviewer_name, item.reviewer_id)}{" "}
                    ·{" "}
                    {item.reviewed_at
                      ? formatDate(item.reviewed_at)
                      : "Unknown time"}
                  </p>
                  <p className="mt-2 line-clamp-1 text-sm font-medium">
                    {item.commit_message ||
                      "No publish commit message provided."}
                  </p>
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {item.review_note || "No reviewer comment provided."}
                  </p>
                </div>
                <Link
                  to="/reviews/$requestId"
                  params={{ requestId: item.id }}
                  className="inline-flex items-center gap-2 self-start rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-muted lg:self-auto"
                >
                  <FileDiff className="size-4" />
                  View review
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function identity(name: string | null, id: string | null) {
  if (!name && !id) return "Deleted user";
  if (!id) return name;
  return `${name ?? "Unknown user"} · @${id}`;
}
