import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileDiff,
  FileImage,
  FilePlus,
  FileX,
  GitCompare,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import type {
  AdminPublishReviewDetail,
  PublishReviewDiffLine,
  PublishReviewFile,
  PublishReviewFileDetail,
} from "@nest/shared";
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorBox,
  RefreshButton,
  Skeleton,
  formatDate,
} from "../components/ui";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { cn } from "../lib/cn";
import { collapseDiffContext, expandedDiff } from "../lib/review-diff";

type ChangeFilter = "all" | "added" | "modified" | "deleted";

export function ReviewDetailPage() {
  const { requestId } = useParams({ from: "/reviews/$requestId" });
  const api = useApi();
  const qc = useQueryClient();
  const [selectedPath, setSelectedPath] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");

  const review = useQuery({
    queryKey: adminQueryKeys.reviewDetail(requestId),
    queryFn: () =>
      api<AdminPublishReviewDetail>(
        `/api/admin/publish-requests/${requestId}/review`,
      ),
  });
  const files = review.data?.files ?? [];
  const visibleFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.filter(
      (file) =>
        (filter === "all" || file.status === filter) &&
        (!query || file.path.toLowerCase().includes(query)),
    );
  }, [files, filter, search]);

  useEffect(() => {
    if (!selectedPath || !files.some((file) => file.path === selectedPath)) {
      setSelectedPath(files[0]?.path ?? "");
    }
  }, [files, selectedPath]);

  const fileDetail = useQuery({
    queryKey: adminQueryKeys.reviewFile(requestId, selectedPath),
    queryFn: () => {
      const params = new URLSearchParams({ path: selectedPath });
      return api<PublishReviewFileDetail>(
        `/api/admin/publish-requests/${requestId}/review/file?${params}`,
      );
    },
    enabled:
      Boolean(selectedPath) &&
      review.data?.diff_available === true &&
      files.some((file) => file.path === selectedPath),
  });

  const mutateDecision = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      api(`/api/admin/publish-requests/${requestId}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || undefined }),
      }),
    onSuccess: async () => {
      setDecision(null);
      setNote("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: adminQueryKeys.reviews }),
        qc.invalidateQueries({ queryKey: adminQueryKeys.reviewHistory }),
        qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
        qc.invalidateQueries({
          queryKey: adminQueryKeys.reviewDetail(requestId),
        }),
      ]);
    },
  });

  if (review.isLoading) return <ReviewDetailSkeleton />;
  if (review.error || !review.data)
    return (
      <div>
        <BackLink />
        <ErrorBox error={review.error ?? "Publish review not found"} />
      </div>
    );

  const item = review.data;
  const selectedFile = files.find((file) => file.path === selectedPath) ?? null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <BackLink />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {item.name}
            </h1>
            <Badge tone={statusTone(item.status)}>{item.status}</Badge>
            {item.request_type === "live_patch" && (
              <Badge tone="amber">Live patch</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <code>{item.pack_id}</code> ·{" "}
            {item.request_type === "live_patch"
              ? `v${item.version} · Patch ${item.base_patch_revision} → Patch ${item.patch_revision}`
              : `${item.base_version ?? "Empty pack"} → ${item.version}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {item.status === "pending" && (
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
          )}
          <RefreshButton
            onClick={() => void review.refetch()}
            busy={review.isFetching}
          />
        </div>
      </div>

      {(fileDetail.error || mutateDecision.error) && (
        <ErrorBox error={fileDetail.error || mutateDecision.error} />
      )}

      <ReviewOverview item={item} />

      {!item.diff_available ? (
        <Card>
          <div className="flex gap-3">
            <FileDiff className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <h2 className="font-medium">Source diff unavailable</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.diff_unavailable_reason}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="grid min-h-[580px] lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="border-b border-border bg-panel lg:border-b-0 lg:border-r">
              <div className="space-y-3 border-b border-border p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <input
                    className="input py-2 pl-8 text-sm"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Filter changed files"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {(["all", "modified", "added", "deleted"] as const).map(
                    (value) => (
                      <button
                        key={value}
                        type="button"
                        className={cn(
                          "rounded-md px-2 py-1 text-xs capitalize",
                          filter === value
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                        onClick={() => setFilter(value)}
                      >
                        {value}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="max-h-72 overflow-auto p-2 lg:max-h-[510px]">
                {visibleFiles.map((file) => (
                  <FileButton
                    key={file.path}
                    file={file}
                    active={file.path === selectedPath}
                    onClick={() => setSelectedPath(file.path)}
                  />
                ))}
                {visibleFiles.length === 0 && (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No changed files match this filter.
                  </p>
                )}
              </div>
            </aside>
            <main className="min-w-0">
              {selectedFile ? (
                <FileReview
                  requestId={requestId}
                  file={selectedFile}
                  detail={fileDetail.data}
                  loading={fileDetail.isLoading}
                />
              ) : (
                <div className="grid h-full place-items-center p-10 text-sm text-muted-foreground">
                  Select a changed file to inspect it.
                </div>
              )}
            </main>
          </div>
        </Card>
      )}

      {item.status === "pending" ? (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur">
          <div>
            <p className="text-sm font-medium">Ready to make a decision?</p>
            <p className="text-xs text-muted-foreground">
              {item.request_type === "live_patch"
                ? "Approval replaces this release with the reviewed patch immediately."
                : "Approval releases this version to Hub users immediately."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={mutateDecision.isPending}
              onClick={() => {
                setNote("");
                setDecision("reject");
              }}
            >
              <X />
              Reject
            </Button>
            <Button
              disabled={mutateDecision.isPending || !item.diff_available}
              title={
                item.diff_available
                  ? undefined
                  : "A source diff is required before approval."
              }
              onClick={() => {
                setNote("");
                setDecision("approve");
              }}
            >
              <Check />
              {item.request_type === "live_patch"
                ? "Approve live patch"
                : "Approve & release"}
            </Button>
          </div>
        </div>
      ) : (
        <DecisionReceipt item={item} />
      )}

      <DecisionDialog
        action={decision}
        note={note}
        pending={mutateDecision.isPending}
        onNoteChange={setNote}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
            setNote("");
          }
        }}
        onConfirm={() => decision && mutateDecision.mutate(decision)}
        livePatch={item.request_type === "live_patch"}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/reviews"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Publishing reviews
    </Link>
  );
}

function ReviewOverview({ item }: { item: AdminPublishReviewDetail }) {
  const summary = item.summary;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <SummaryValue label="Files" value={summary.changed_files} />
          <SummaryValue
            label="Added"
            value={summary.added_files}
            className="text-emerald-700"
          />
          <SummaryValue
            label="Modified"
            value={summary.modified_files}
            className="text-amber-700"
          />
          <SummaryValue
            label="Deleted"
            value={summary.deleted_files}
            className="text-destructive"
          />
          <div className="ml-auto font-mono text-sm">
            <span className="text-emerald-700">+{summary.additions}</span>{" "}
            <span className="text-destructive">−{summary.deletions}</span>
          </div>
        </div>
        <div className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Publish commit message
          </p>
          <p className="mt-1 text-sm font-medium">
            {item.commit_message || "No publish commit message provided."}
          </p>
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pack description
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {item.description || "No pack description provided."}
            </p>
          </div>
        </div>
      </Card>
      <Card className="space-y-2 text-sm">
        <MetaRow
          label="Submitted by"
          value={identity(item.submitter_name, item.submitter_id)}
        />
        <MetaRow label="Submitted" value={formatDate(item.created_at)} />
        <MetaRow label="Request" value={item.id} mono />
        <MetaRow label="Checksum" value={item.checksum} mono />
      </Card>
    </div>
  );
}

function SummaryValue({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div>
      <p className={cn("text-xl font-semibold", className)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right",
          mono && "font-mono text-xs",
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function FileButton({
  file,
  active,
  onClick,
}: {
  file: PublishReviewFile;
  active: boolean;
  onClick: () => void;
}) {
  const Icon =
    file.status === "added"
      ? FilePlus
      : file.status === "deleted"
        ? FileX
        : file.kind === "image"
          ? FileImage
          : File;
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm",
        active ? "bg-muted text-foreground" : "hover:bg-muted/70",
      )}
      onClick={onClick}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          file.status === "added" && "text-emerald-700",
          file.status === "modified" && "text-amber-700",
          file.status === "deleted" && "text-destructive",
        )}
      />
      <span className="min-w-0 flex-1 truncate" title={file.path}>
        {file.path}
      </span>
      {file.additions != null && (
        <span className="shrink-0 font-mono text-[10px]">
          <span className="text-emerald-700">+{file.additions}</span>{" "}
          <span className="text-destructive">−{file.deletions}</span>
        </span>
      )}
    </button>
  );
}

function FileReview({
  requestId,
  file,
  detail,
  loading,
}: {
  requestId: string;
  file: PublishReviewFile;
  detail: PublishReviewFileDetail | undefined;
  loading: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompare className="size-4 shrink-0 text-muted-foreground" />
          <code className="truncate text-xs">{file.path}</code>
          <Badge tone={fileTone(file.status)}>{file.status}</Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {formatBytes(file.old_size)} → {formatBytes(file.new_size)}
        </div>
      </div>
      {loading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : detail?.kind === "text" ? (
        <UnifiedDiff lines={detail.lines} />
      ) : detail?.kind === "image" ? (
        <ImageDiff
          requestId={requestId}
          file={file}
          oldAvailable={detail.old_available}
          newAvailable={detail.new_available}
        />
      ) : (
        <BinaryDiff file={file} reason={detail?.reason} />
      )}
    </div>
  );
}

function UnifiedDiff({ lines }: { lines: PublishReviewDiffLine[] }) {
  const [expanded, setExpanded] = useState(false);
  const displayed = useMemo(
    () => (expanded ? expandedDiff(lines) : collapseDiffContext(lines)),
    [expanded, lines],
  );
  return (
    <div>
      <div className="flex justify-end border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
          {expanded ? "Collapse context" : "Expand all"}
        </Button>
      </div>
      <div className="max-h-[650px] overflow-auto bg-card font-mono text-xs">
        {displayed.map((entry, index) =>
          entry.kind === "gap" ? (
            <button
              key={`gap-${index}`}
              type="button"
              className="w-full border-y border-sky-200 bg-sky-50 px-3 py-1 text-left text-sky-800 hover:bg-sky-100"
              onClick={() => setExpanded(true)}
            >
              <ChevronRight className="mr-1 inline size-3" />
              {entry.count} unchanged lines
            </button>
          ) : (
            <DiffLine key={`${entry.line.type}-${index}`} line={entry.line} />
          ),
        )}
        {lines.length === 0 && (
          <p className="p-8 text-center font-sans text-sm text-muted-foreground">
            The text content is unchanged.
          </p>
        )}
      </div>
    </div>
  );
}

function DiffLine({ line }: { line: PublishReviewDiffLine }) {
  return (
    <div
      className={cn(
        "grid min-w-max grid-cols-[48px_48px_24px_minmax(320px,1fr)]",
        line.type === "added" && "bg-emerald-50",
        line.type === "deleted" && "bg-red-50",
      )}
    >
      <span className="select-none border-r border-border/70 px-2 text-right text-muted-foreground">
        {line.old_line ?? ""}
      </span>
      <span className="select-none border-r border-border/70 px-2 text-right text-muted-foreground">
        {line.new_line ?? ""}
      </span>
      <span
        className={cn(
          "select-none text-center",
          line.type === "added" && "text-emerald-700",
          line.type === "deleted" && "text-destructive",
        )}
      >
        {line.type === "added" ? "+" : line.type === "deleted" ? "−" : " "}
      </span>
      <span className="whitespace-pre px-2">{line.content || " "}</span>
    </div>
  );
}

function ImageDiff({
  requestId,
  file,
  oldAvailable,
  newAvailable,
}: {
  requestId: string;
  file: PublishReviewFile;
  oldAvailable: boolean;
  newAvailable: boolean;
}) {
  return (
    <div className="grid gap-4 bg-panel p-4 md:grid-cols-2">
      <ImageSide
        label="Before"
        available={oldAvailable}
        size={file.old_size}
        hash={file.old_sha256}
        src={reviewImageUrl(requestId, file.path, "old")}
      />
      <ImageSide
        label="After"
        available={newAvailable}
        size={file.new_size}
        hash={file.new_sha256}
        src={reviewImageUrl(requestId, file.path, "new")}
      />
    </div>
  );
}

function ImageSide({
  label,
  available,
  size,
  hash,
  src,
}: {
  label: string;
  available: boolean;
  size: number | null;
  hash: string | null;
  src: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{formatBytes(size)}</span>
      </div>
      <div className="grid min-h-56 place-items-center bg-[linear-gradient(45deg,#eee_25%,transparent_25%),linear-gradient(-45deg,#eee_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#eee_75%),linear-gradient(-45deg,transparent_75%,#eee_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] p-3">
        {available ? (
          <img
            src={src}
            alt={`${label} image`}
            className="max-h-96 max-w-full object-contain"
          />
        ) : (
          <span className="text-sm text-muted-foreground">No image</span>
        )}
      </div>
      {hash && (
        <code className="block truncate border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          sha256 {hash}
        </code>
      )}
    </div>
  );
}

function BinaryDiff({
  file,
  reason,
}: {
  file: PublishReviewFile;
  reason?: string;
}) {
  return (
    <div className="space-y-4 p-6">
      <div className="flex gap-3 rounded-lg bg-muted p-4">
        <File className="mt-0.5 size-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Inline preview unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {reason ??
              file.inline_unavailable_reason ??
              "This binary file cannot be rendered safely."}
          </p>
        </div>
      </div>
      <HashComparison file={file} />
    </div>
  );
}

function HashComparison({ file }: { file: PublishReviewFile }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[
        ["Before", file.old_size, file.old_sha256],
        ["After", file.new_size, file.new_sha256],
      ].map(([label, size, hash]) => (
        <div
          key={String(label)}
          className="rounded-lg border border-border p-3"
        >
          <p className="text-xs font-medium">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatBytes(size as number | null)}
          </p>
          <code className="mt-2 block break-all text-[10px]">
            {(hash as string | null) ?? "Not present"}
          </code>
        </div>
      ))}
    </div>
  );
}

function DecisionReceipt({ item }: { item: AdminPublishReviewDetail }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(item.status)}>{item.status}</Badge>
            <span className="text-sm font-medium">
              {identity(item.reviewer_name, item.reviewer_id)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.reviewed_at ? formatDate(item.reviewed_at) : "Unknown time"}
          </p>
        </div>
        <p className="max-w-2xl rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          {item.review_note || "No reviewer comment was provided."}
        </p>
      </div>
    </Card>
  );
}

function DecisionDialog({
  action,
  note,
  pending,
  onNoteChange,
  onOpenChange,
  onConfirm,
  livePatch,
}: {
  action: "approve" | "reject" | null;
  note: string;
  pending: boolean;
  onNoteChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  livePatch: boolean;
}) {
  const rejecting = action === "reject";
  return (
    <Dialog
      open={action != null}
      onOpenChange={onOpenChange}
      title={
        rejecting
          ? `Reject ${livePatch ? "live patch" : "publish request"}`
          : livePatch
            ? "Approve live patch"
            : "Approve and release"
      }
      description={
        rejecting
          ? "Explain what the publisher should change before resubmitting."
          : livePatch
            ? "The reviewed files will replace this release immediately."
            : "This version will become available to Hub users immediately."
      }
    >
      <label className="text-sm font-medium">
        Reviewer comment{" "}
        {!rejecting && (
          <span className="font-normal text-muted-foreground">(optional)</span>
        )}
      </label>
      <textarea
        className="input mt-2 min-h-28 resize-y"
        value={note}
        onChange={(event) => onNoteChange(event.target.value)}
        autoFocus
      />
      <div className="mt-5 flex justify-end gap-2">
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Cancel</Button>
        </DialogPrimitive.Close>
        <Button
          variant={rejecting ? "danger" : "primary"}
          disabled={pending || (rejecting && !note.trim())}
          onClick={onConfirm}
        >
          {rejecting ? <X /> : <Check />}
          {rejecting
            ? "Send rejection"
            : livePatch
              ? "Approve live patch"
              : "Approve & release"}
        </Button>
      </div>
    </Dialog>
  );
}

function ReviewDetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-10 w-80" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <Skeleton className="h-[580px]" />
    </div>
  );
}

function reviewImageUrl(
  requestId: string,
  filePath: string,
  side: "old" | "new",
) {
  const params = new URLSearchParams({ path: filePath, side });
  return `/api/admin/publish-requests/${requestId}/review/image?${params}`;
}

function identity(name: string | null, id: string | null) {
  if (!name && !id) return "Deleted user";
  if (!id) return name ?? "Unknown user";
  return `${name ?? "Unknown user"} · @${id}`;
}

function formatBytes(value: number | null) {
  if (value == null) return "Not present";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusTone(status: AdminPublishReviewDetail["status"]) {
  if (status === "approved") return "green" as const;
  if (status === "rejected") return "red" as const;
  return "amber" as const;
}

function fileTone(status: PublishReviewFile["status"]) {
  if (status === "added") return "green" as const;
  if (status === "deleted") return "red" as const;
  return "amber" as const;
}
