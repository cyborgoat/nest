import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Download, Eye, X } from "lucide-react";
import type {
  AdminPublishHistoryPage,
  AdminPublishRequest,
  PendingPublishRequest as RequestItem,
} from "@nest/shared";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  Dialog,
  Empty,
  ErrorBox,
  InfoRow,
  RefreshButton,
  Select,
  Skeleton,
  formatDate,
} from "../components/ui";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { useAdminData } from "../lib/hooks";
import { PageHeader } from "../layout/PageHeader";

type ReviewTab = "queue" | "history";
type HistoryStatus = "all" | "approved" | "rejected";

export function ReviewsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { reviews } = useAdminData();
  const [tab, setTab] = useState<ReviewTab>("queue");
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("all");
  const [historyDetail, setHistoryDetail] =
    useState<AdminPublishRequest | null>(null);
  const [reject, setReject] = useState<RequestItem | null>(null);
  const [approveTarget, setApproveTarget] = useState<RequestItem | null>(null);
  const [note, setNote] = useState("");
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
  const historyItems =
    history.data?.pages.flatMap((page) => page.items) ?? [];

  const review = useMutation({
    mutationFn: ({
      item,
      action,
    }: {
      item: RequestItem;
      action: "approve" | "reject";
    }) =>
      api(`/api/admin/publish-requests/${item.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || undefined }),
      }),
    onSuccess: () => {
      setReject(null);
      setApproveTarget(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: adminQueryKeys.reviews });
      void qc.invalidateQueries({ queryKey: adminQueryKeys.reviewHistory });
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
    },
  });

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
        description="Review incoming releases and inspect completed decisions."
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

      {(reviews.error || history.error || review.error) && (
        <ErrorBox error={reviews.error || history.error || review.error} />
      )}
      {tab === "queue" ? (
        <Queue
          reviews={reviews.data}
          loading={reviews.isLoading}
          reviewing={review.isPending}
          onApprove={(item) => {
            setNote("");
            setApproveTarget(item);
          }}
          onReject={(item) => {
            setNote("");
            setReject(item);
          }}
        />
      ) : (
        <History
          items={historyItems}
          status={historyStatus}
          loading={history.isLoading}
          hasNextPage={history.hasNextPage}
          loadingMore={history.isFetchingNextPage}
          onStatusChange={(value) =>
            setHistoryStatus(value as HistoryStatus)
          }
          onView={setHistoryDetail}
          onLoadMore={() => void history.fetchNextPage()}
        />
      )}

      <Dialog
        open={Boolean(approveTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setApproveTarget(null);
            setNote("");
          }
        }}
        title="Approve and release"
        description={`Release ${approveTarget?.pack_id ?? "this pack"}@${approveTarget?.version ?? ""} to every Hub user.`}
      >
        <label className="text-sm font-medium">
          Reviewer comment <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          className="input mt-2 min-h-24 resize-y"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add context for this approval."
        />
        <div className="mt-5 flex justify-end gap-2">
          <DialogPrimitive.Close asChild>
            <Button variant="outline">Cancel</Button>
          </DialogPrimitive.Close>
          <Button
            disabled={!approveTarget || review.isPending}
            onClick={() =>
              approveTarget &&
              review.mutate({ item: approveTarget, action: "approve" })
            }
          >
            <Check />
            Approve & release
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(reject)}
        onOpenChange={(open) => {
          if (!open) {
            setReject(null);
            setNote("");
          }
        }}
        title="Reject publish request"
        description={`Explain what ${reject?.submitter_name ?? "the publisher"} should change before resubmitting.`}
      >
        <label className="text-sm font-medium">Review comment</label>
        <textarea
          className="input mt-2 min-h-28 resize-y"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          autoFocus
        />
        <div className="mt-5 flex justify-end gap-2">
          <DialogPrimitive.Close asChild>
            <Button variant="outline">Cancel</Button>
          </DialogPrimitive.Close>
          <Button
            variant="danger"
            disabled={!note.trim() || review.isPending}
            onClick={() =>
              reject && review.mutate({ item: reject, action: "reject" })
            }
          >
            Send rejection
          </Button>
        </div>
      </Dialog>

      <HistoryDetail
        item={historyDetail}
        onOpenChange={(open) => !open && setHistoryDetail(null)}
      />
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
  reviewing,
  onApprove,
  onReject,
}: {
  reviews: RequestItem[] | undefined;
  loading: boolean;
  reviewing: boolean;
  onApprove: (item: RequestItem) => void;
  onReject: (item: RequestItem) => void;
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
            <div className="flex shrink-0 flex-wrap gap-2">
              <a
                className={buttonClass("outline", "sm")}
                href={`/api/admin/publish-requests/${item.id}/download`}
                download
              >
                <Download />
                Download
              </a>
              <Button
                variant="danger"
                size="sm"
                disabled={reviewing}
                onClick={() => onReject(item)}
              >
                <X />
                Reject
              </Button>
              <Button
                size="sm"
                disabled={reviewing}
                onClick={() => onApprove(item)}
              >
                <Check />
                Approve & release
              </Button>
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
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Submitted by <strong className="text-foreground">{item.submitter_name}</strong>{" "}
        · @{item.submitter_id} · {formatDate(item.created_at)} ·{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
          sha256 {item.checksum.slice(0, 14)}…
        </code>
      </p>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
        {item.description || "No description provided."}
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
  onView,
  onLoadMore,
}: {
  items: AdminPublishRequest[];
  status: HistoryStatus;
  loading: boolean;
  hasNextPage: boolean;
  loadingMore: boolean;
  onStatusChange: (value: string) => void;
  onView: (item: AdminPublishRequest) => void;
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
                    </span>
                    <Badge tone={item.status === "approved" ? "green" : "red"}>
                      {item.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reviewed by {identity(item.reviewer_name, item.reviewer_id)}{" "}
                    · {item.reviewed_at ? formatDate(item.reviewed_at) : "Unknown time"}
                  </p>
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {item.review_note || "No reviewer comment provided."}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => onView(item)}>
                  <Eye />
                  View details
                </Button>
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

function HistoryDetail({
  item,
  onOpenChange,
}: {
  item: AdminPublishRequest | null;
  onOpenChange: (open: boolean) => void;
}) {
  const validation = parseValidation(item?.validation_json);
  return (
    <Dialog
      open={Boolean(item)}
      onOpenChange={onOpenChange}
      title={item ? `${item.name} ${item.version}` : "Review details"}
      description="Immutable metadata recorded for this publishing decision."
    >
      {item && (
        <div className="space-y-5">
          <div className="space-y-2 text-sm">
            <InfoRow label="Decision">
              <Badge tone={item.status === "approved" ? "green" : "red"}>
                {item.status}
              </Badge>
            </InfoRow>
            <InfoRow label="Pack ID">
              <code>{item.pack_id}</code>
            </InfoRow>
            <InfoRow label="Request ID">
              <code className="max-w-64 truncate">{item.id}</code>
            </InfoRow>
            <InfoRow label="Submitted by">
              <span>{identity(item.submitter_name, item.submitter_id)}</span>
            </InfoRow>
            <InfoRow label="Reviewed by">
              <span>{identity(item.reviewer_name, item.reviewer_id)}</span>
            </InfoRow>
            <InfoRow label="Submitted">
              <span>{formatDate(item.created_at)}</span>
            </InfoRow>
            <InfoRow label="Reviewed">
              <span>
                {item.reviewed_at ? formatDate(item.reviewed_at) : "Unknown"}
              </span>
            </InfoRow>
          </div>
          <div>
            <p className="text-sm font-medium">Reviewer comment</p>
            <p className="mt-1 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              {item.review_note || "No comment provided."}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Description</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.description || "No description provided."}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Artifact checksum</p>
            <code className="mt-1 block break-all rounded-lg bg-muted p-3 text-xs">
              {item.checksum}
            </code>
          </div>
          <div>
            <p className="text-sm font-medium">
              Validated files ({validation.files.length})
            </p>
            <div className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs">
              {validation.files.length
                ? validation.files.map((file) => <div key={file}>{file}</div>)
                : "No file list recorded."}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function identity(name: string | null, id: string | null) {
  if (!name && !id) return "Deleted user";
  if (!id) return name;
  return `${name ?? "Unknown user"} · @${id}`;
}

function parseValidation(raw: string | undefined): { files: string[] } {
  try {
    const parsed = JSON.parse(raw ?? "{}") as { files?: unknown };
    return {
      files: Array.isArray(parsed.files)
        ? parsed.files.filter((file): file is string => typeof file === "string")
        : [],
    };
  } catch {
    return { files: [] };
  }
}
