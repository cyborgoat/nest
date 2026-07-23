import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, X } from "lucide-react";
import type { PendingPublishRequest as RequestItem } from "@nest/shared";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Empty,
  ErrorBox,
  RefreshButton,
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
      {review.error && <ErrorBox error={review.error} />}
      <div className="space-y-4">
        {reviews.data?.map((item) => (
          <Card
            key={item.id}
            className="flex flex-col justify-between gap-6 md:flex-row"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{item.pack_id}</Badge>
                <span className="text-sm font-semibold">v{item.version}</span>
              </div>
              <h2 className="mt-3 font-serif text-2xl">{item.name}</h2>
              <p className="mt-1 max-w-2xl text-sm text-stone-500">
                {item.description || "No description provided."}
              </p>
              <p className="mt-4 text-xs text-stone-500">
                Submitted by{" "}
                <strong className="text-stone-700">
                  {item.submitter_name}
                </strong>{" "}
                · @{item.submitter_id} · {formatDate(item.created_at)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end justify-between gap-5">
              <code className="rounded bg-stone-100 px-2 py-1 text-[11px] text-stone-500">
                sha256 {item.checksum.slice(0, 14)}…
              </code>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  disabled={review.isPending}
                  onClick={() => setReject(item)}
                >
                  <X />
                  Reject
                </Button>
                <Button
                  disabled={review.isPending}
                  onClick={() => review.mutate({ item, action: "approve" })}
                >
                  <Check />
                  Approve & release
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {reviews.data?.length === 0 && (
          <Empty
            title="The queue is clear"
            body="New pack and version submissions will appear here."
          />
        )}
      </div>
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
