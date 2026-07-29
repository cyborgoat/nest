import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { HubMessage, HubMessageKind } from "@nest/shared";
import {
  Bell,
  Check,
  CheckCheck,
  CircleAlert,
  Inbox,
  CloudUpload,
  Eye,
  Trash2,
  Merge,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelHeader } from "@/components/ui/panel-header";
import { RefreshButton } from "@/components/ui/refresh-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { useUiStore } from "@/stores/ui";
import { useEffect, useState } from "react";
import { useMergeApprovedPack } from "@/hooks/use-merge-approved-pack";

const MESSAGE_KIND_STYLES: Partial<
  Record<HubMessageKind, { Icon: LucideIcon; iconClass: string }>
> = {
  publish_submitted: { Icon: CloudUpload, iconClass: "text-accent-text" },
  publish_approved: { Icon: Check, iconClass: "text-success" },
  publish_rejected: { Icon: CircleAlert, iconClass: "text-destructive" },
};

const FALLBACK_KIND_STYLE = {
  Icon: Bell,
  iconClass: "text-muted-foreground",
} as const;

function formatMessageTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function MessagesPanel() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [selectedMessage, setSelectedMessage] = useState<HubMessage | null>(
    null,
  );
  const queryClient = useQueryClient();
  const openAccountSettingsTab = useUiStore(
    (state) => state.openAccountSettingsTab,
  );
  const requestedPublishMessageId = useUiStore(
    (state) => state.requestedPublishMessageId,
  );
  const clearRequestedPublishMessage = useUiStore(
    (state) => state.clearRequestedPublishMessage,
  );
  const auth = useQuery({ queryKey: queryKeys.hubAuth, queryFn: api.hubAuthState });
  const messages = useInfiniteQuery({
    queryKey: queryKeys.messagesFor(filter),
    queryFn: ({ pageParam }) =>
      api.hubListMessages(filter, pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: auth.data?.authenticated === true,
    refetchInterval: 30_000,
  });
  const installed = useQuery({
    queryKey: queryKeys.installedPacks,
    queryFn: api.hubListInstalled,
  });
  const mergeApproved = useMergeApprovedPack();
  const refresh = async () => {
    const reconciled = await api.hubReconcilePublishRequests();
    queryClient.setQueryData(queryKeys.installedPacks, reconciled);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.messages }),
      queryClient.invalidateQueries({ queryKey: queryKeys.messageCount }),
      queryClient.invalidateQueries({ queryKey: ["pack-status"] }),
    ]);
  };
  useEffect(() => {
    if (auth.data?.authenticated) void refresh();
    // Refresh once when the signed-in Messages view opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.data?.authenticated]);
  const action = useMutation({
    mutationFn: async (input: { type: "read" | "delete"; id: string }) =>
      input.type === "read"
        ? api.hubMarkMessageRead(input.id)
        : api.hubDeleteMessage(input.id),
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error("Could not update message", {
        description: appErrorMessage(error),
      }),
  });
  const bulk = useMutation({
    mutationFn: (type: "read-all" | "delete-read") =>
      type === "read-all"
        ? api.hubMarkAllMessagesRead()
        : api.hubDeleteReadMessages(),
    onSuccess: refresh,
    onError: (error: unknown) =>
      toast.error("Could not update messages", {
        description: appErrorMessage(error),
      }),
  });
  const items = messages.data?.pages.flatMap((page) => page.items) ?? [];
  useEffect(() => {
    if (!requestedPublishMessageId) return;
    const match = items.find(
      (message) => message.publish_request_id === requestedPublishMessageId,
    );
    if (match) {
      setSelectedMessage(match);
      clearRequestedPublishMessage();
      return;
    }
    if (messages.hasNextPage && !messages.isFetchingNextPage) {
      void messages.fetchNextPage();
    }
  }, [
    clearRequestedPublishMessage,
    items,
    messages,
    requestedPublishMessageId,
  ]);

  const mergeInputFor = (message: HubMessage) => {
    if (message.kind !== "publish_approved" || !message.publish_request_id) {
      return null;
    }
    const pack = (installed.data ?? []).find(
      (candidate) =>
        candidate.pack_id === message.pack_id &&
        candidate.pending_request_id === message.publish_request_id &&
        candidate.publish_review_status === "approved_awaiting_merge",
    );
    return pack
      ? { packId: pack.pack_id, requestId: message.publish_request_id }
      : null;
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Messages"
        description="Publishing updates and notices from Nest Hub."
        actions={
          auth.data?.authenticated ? (
            <div className="flex items-center gap-2">
              <RefreshButton
                onRefresh={refresh}
                refreshing={messages.isFetching}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={bulk.isPending}
                onClick={() => bulk.mutate("read-all")}
              >
                <CheckCheck className="size-4" />
                Mark all read
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bulk.isPending}
                onClick={() => bulk.mutate("delete-read")}
              >
                <Trash2 className="size-4" />
                Delete read
              </Button>
            </div>
          ) : undefined
        }
      />
      {auth.isLoading ? null : !auth.data?.authenticated ? (
        <EmptyState
          icon={<Bell className="size-8 text-primary" />}
          title="Sign in to see Hub messages"
          description="Messages are tied to your optional Nest Hub account. Local knowledge packs remain available without signing in."
        >
          <Button onClick={openAccountSettingsTab}>
            Open account settings
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className="border-b px-4 py-3">
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as "all" | "unread")}
            >
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unread">Unread</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto max-w-3xl">
              {messages.isLoading ? (
                <div className="flex justify-center py-10">
                  <Spinner className="size-5 text-muted-foreground" />
                </div>
              ) : messages.error ? (
                <p className="p-5 text-sm text-destructive">
                  {(messages.error as Error).message}
                </p>
              ) : items.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<Inbox className="size-7 text-muted-foreground" />}
                    title={
                      filter === "unread"
                        ? "You’re all caught up"
                        : "No messages yet"
                    }
                    description="Publishing confirmations and review decisions will appear here."
                  />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {items.map((message) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      busy={action.isPending}
                      onRead={() =>
                        action.mutate({ type: "read", id: message.id })
                      }
                      onDelete={() =>
                        action.mutate({ type: "delete", id: message.id })
                      }
                      onView={() => setSelectedMessage(message)}
                      onMerge={
                        mergeInputFor(message)
                          ? () => mergeApproved.mutate(mergeInputFor(message)!)
                          : undefined
                      }
                      merging={mergeApproved.isPending}
                    />
                  ))}
                </div>
              )}
              {messages.hasNextPage && (
                <div className="flex justify-center py-4">
                  <Button
                    variant="outline"
                    disabled={messages.isFetchingNextPage}
                    onClick={() => void messages.fetchNextPage()}
                  >
                    {messages.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}
      <MessageDetailsDialog
        message={selectedMessage}
        onMerge={
          selectedMessage && mergeInputFor(selectedMessage)
            ? () => mergeApproved.mutate(mergeInputFor(selectedMessage)!)
            : undefined
        }
        merging={mergeApproved.isPending}
        onOpenChange={(open) => {
          if (!open) setSelectedMessage(null);
        }}
      />
    </div>
  );
}

function MessageRow({
  message,
  busy,
  onRead,
  onDelete,
  onView,
  onMerge,
  merging,
}: {
  message: HubMessage;
  busy: boolean;
  onRead: () => void;
  onDelete: () => void;
  onView: () => void;
  onMerge?: () => void;
  merging: boolean;
}) {
  const unread = !message.read_at;
  const { Icon, iconClass } =
    MESSAGE_KIND_STYLES[message.kind] ?? FALLBACK_KIND_STYLE;
  return (
    <article
      className={cn(
        "group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
        unread && "bg-primary/[0.03]",
      )}
    >
      <Icon className={cn("size-4 shrink-0", iconClass)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          {unread && (
            <span
              className="size-1.5 shrink-0 self-center rounded-full bg-primary"
              aria-label="Unread"
            />
          )}
          <h3
            className={cn(
              "min-w-0 truncate text-sm",
              unread ? "font-semibold" : "font-medium",
            )}
          >
            {message.title}
          </h3>
          <time
            dateTime={message.created_at}
            className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
          >
            {formatMessageTime(message.created_at)}
          </time>
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {onMerge && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={merging}
                onClick={onMerge}
              >
                {merging ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Merge className="size-4" />
                )}
                Merge
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Merge reviewed release with local pack
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="View message details"
              onClick={onView}
            >
              <Eye className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">View details</TooltipContent>
        </Tooltip>
        {unread && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label="Mark read"
                onClick={onRead}
              >
                <Check className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Mark read</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label="Delete message"
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Delete message</TooltipContent>
        </Tooltip>
      </div>
    </article>
  );
}

function MessageDetailsDialog({
  message,
  onOpenChange,
  onMerge,
  merging,
}: {
  message: HubMessage | null;
  onOpenChange: (open: boolean) => void;
  onMerge?: () => void;
  merging: boolean;
}) {
  return (
    <Dialog open={message != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{message?.title ?? "Message details"}</DialogTitle>
          <DialogDescription>
            {message
              ? new Date(message.created_at).toLocaleString()
              : "Nest Hub message"}
          </DialogDescription>
        </DialogHeader>
        {message && (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap text-sm leading-6">
              {message.body}
            </p>
            {(message.pack_id || message.publish_request_id) && (
              <dl className="grid gap-2 rounded-md bg-muted/50 p-3 text-xs">
                {message.pack_id && (
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-muted-foreground">Knowledge pack</dt>
                    <dd className="break-all font-medium">{message.pack_id}</dd>
                  </div>
                )}
                {message.publish_request_id && (
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-muted-foreground">Request ID</dt>
                    <dd className="break-all font-mono">
                      {message.publish_request_id}
                    </dd>
                  </div>
                )}
              </dl>
            )}
            {onMerge && (
              <Button
                className="w-full"
                disabled={merging}
                onClick={onMerge}
              >
                {merging ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Merge className="size-4" />
                )}
                Merge with remote
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
