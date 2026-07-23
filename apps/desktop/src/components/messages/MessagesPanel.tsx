import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { HubMessage } from "@nest/shared";
import {
  Bell,
  Check,
  CheckCheck,
  CircleAlert,
  Inbox,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { useUiStore } from "@/stores/ui";
import { useState } from "react";

export function MessagesPanel() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const queryClient = useQueryClient();
  const openAccountSettingsTab = useUiStore(
    (state) => state.openAccountSettingsTab,
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
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.messages }),
      queryClient.invalidateQueries({ queryKey: queryKeys.messageCount }),
    ]);
  };
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

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Messages"
        description="Publishing updates and notices from Nest Hub."
        actions={
          auth.data?.authenticated ? (
            <div className="flex gap-2">
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
            <div className="mx-auto max-w-3xl space-y-3 p-5">
              {messages.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  Loading messages…
                </p>
              ) : messages.error ? (
                <p className="text-sm text-destructive">
                  {(messages.error as Error).message}
                </p>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="size-7 text-muted-foreground" />}
                  title={
                    filter === "unread"
                      ? "You’re all caught up"
                      : "No messages yet"
                  }
                  description="Publishing confirmations and review decisions will appear here."
                />
              ) : (
                items.map((message) => (
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
                  />
                ))
              )}
              {messages.hasNextPage && (
                <div className="flex justify-center pt-2">
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
    </div>
  );
}

function MessageRow({
  message,
  busy,
  onRead,
  onDelete,
}: {
  message: HubMessage;
  busy: boolean;
  onRead: () => void;
  onDelete: () => void;
}) {
  const unread = !message.read_at;
  const Icon =
    message.kind === "publish_submitted"
      ? Send
      : message.kind === "publish_approved"
        ? Check
        : CircleAlert;
  const tone =
    message.kind === "publish_rejected"
      ? "text-destructive bg-destructive/10"
      : message.kind === "publish_approved"
        ? "text-primary bg-primary/10"
        : "text-accent-foreground bg-accent/15";
  return (
    <article
      className={`rounded-lg border bg-card p-4 transition-colors ${unread ? "border-primary/30 shadow-sm" : "border-border"}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${tone}`}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{message.title}</h3>
            {unread && <Badge variant="accent">New</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{message.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {new Date(message.created_at).toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {unread && (
            <Button
              size="icon"
              variant="ghost"
              disabled={busy}
              title="Mark read"
              onClick={onRead}
            >
              <Check className="size-4" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            title="Delete message"
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}
