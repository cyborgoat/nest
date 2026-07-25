import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Download, X } from "lucide-react";
import type { PendingPublishRequest as RequestItem } from "@nest/shared";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  Dialog,
  Empty,
  ErrorBox,
  RefreshButton,
  Skeleton,
  formatDate,
} from "../components/ui";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { useAdminData } from "../lib/hooks";
import { PageHeader } from "../layout/PageHeader";

export function ReviewsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { reviews } = useAdminData();
  const [reject, setReject] = useState<RequestItem | null>(null);
  const [approveTarget, setApproveTarget] = useState<RequestItem | null>(null);
  const [note, setNote] = useState("");
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
        body: action === "reject" ? JSON.stringify({ note }) : undefined,
      }),
    onSuccess: () => {
      setReject(null);
      setApproveTarget(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: adminQueryKeys.reviews });
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="Publishing"
        title="Review queue"
        description="Validate submitted packages before they become available in the Hub."
        actions={
          <RefreshButton
            onClick={() =>
              qc.invalidateQueries({ queryKey: adminQueryKeys.reviews })
            }
            busy={reviews.isFetching}
          />
        }
      />
      {(reviews.error || review.error) && (
        <ErrorBox error={reviews.error || review.error} />
      )}
      <div className="space-y-4">
        {reviews.isLoading && (
          <Card className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-4 w-full max-w-xl" />
          </Card>
        )}
        {reviews.data && reviews.data.length > 0 && (
          <Card className="p-0">
            <div className="divide-y divide-border">
              {reviews.data.map((item) => (
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
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Submitted by{" "}
                      <strong className="text-foreground">
                        {item.submitter_name}
                      </strong>{" "}
                      · @{item.submitter_id} · {formatDate(item.created_at)} ·{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                        sha256 {item.checksum.slice(0, 14)}…
                      </code>
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {item.description || "No description provided."}
                    </p>
                  </div>
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
                      disabled={review.isPending}
                      onClick={() => setReject(item)}
                    >
                      <X />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={review.isPending}
                      onClick={() => setApproveTarget(item)}
                    >
                      <Check />
                      Approve & release
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
        {reviews.data?.length === 0 && (
          <Empty
            title="The queue is clear"
            body="New pack and version submissions will appear here."
          />
        )}
      </div>
      <ConfirmDialog
        open={Boolean(approveTarget)}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        title="Approve and release"
        description={`Release ${approveTarget?.pack_id ?? "this pack"}@${approveTarget?.version ?? ""} to every Hub user.`}
        confirmLabel="Approve & release"
        busyLabel="Releasing…"
        tone="primary"
        icon={<Check />}
        busy={review.isPending}
        disabled={!approveTarget}
        onConfirm={() =>
          approveTarget &&
          review.mutate({ item: approveTarget, action: "approve" })
        }
      />
      <Dialog
        open={Boolean(reject)}
        onOpenChange={(open) => !open && setReject(null)}
        title="Reject publish request"
        description={`Explain what ${reject?.submitter_name ?? "the publisher"} should change before resubmitting.`}
      >
        <label className="text-sm font-medium">Review note</label>
        <textarea
          className="input mt-2 min-h-28 resize-y"
          value={note}
          onChange={(e) => setNote(e.target.value)}
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
    </>
  );
}
