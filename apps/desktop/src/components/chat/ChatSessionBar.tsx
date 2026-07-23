import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatSession } from "@nest/shared";
import {
  Archive,
  ArchiveRestore,
  Clock,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TabStrip } from "@/components/ui/tab-strip";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

type Props = {
  sessions: ChatSession[];
  onResetChatUi: () => void;
};

export function ChatSessionBar({ sessions, onResetChatUi }: Props) {
  const queryClient = useQueryClient();
  const chatSessionId = useUiStore((s) => s.chatSessionId);
  const openChatTabs = useUiStore((s) => s.openChatTabs);
  const openChatTab = useUiStore((s) => s.openChatTab);
  const closeChatTab = useUiStore((s) => s.closeChatTab);
  const setStatusMessage = useUiStore((s) => s.setStatusMessage);

  const [renameTarget, setRenameTarget] = useState<ChatSession | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, ChatSession>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  const openSessions = openChatTabs
    .map((id) => byId.get(id))
    .filter((s): s is ChatSession => !!s);

  const activeSessions = sessions.filter((s) => !s.archived);
  const archivedSessions = sessions.filter((s) => s.archived);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions });

  const update = useMutation({
    mutationFn: (args: {
      sessionId: string;
      patch: { title?: string; pinned?: boolean; archived?: boolean };
    }) => api.chatUpdateSession(args.sessionId, args.patch),
    onSuccess: () => invalidate(),
    onError: (e: Error) => setStatusMessage(e.message),
  });

  const remove = useMutation({
    mutationFn: (sessionId: string) => api.chatDeleteSession(sessionId),
    onSuccess: (_void, sessionId) => {
      closeChatTab(sessionId);
      queryClient.removeQueries({ queryKey: queryKeys.chatMessages(sessionId) });
      invalidate();
      onResetChatUi();
    },
    onError: (e: Error) => setStatusMessage(e.message),
  });

  const newChat = async () => {
    try {
      if (await activeSessionIsUntouchedPlaceholder()) return;
      const session = await api.chatCreateSession("New chat");
      openChatTab(session.id);
      onResetChatUi();
      invalidate();
    } catch (e) {
      setStatusMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const activeSessionIsUntouchedPlaceholder = async () => {
    const active = chatSessionId ? byId.get(chatSessionId) : undefined;
    if (!active || active.title !== "New chat") return false;
    const messages = await api.chatListMessages(active.id);
    return messages.length === 0;
  };

  const selectSession = (session: ChatSession) => {
    openChatTab(session.id);
    onResetChatUi();
  };

  return (
    <>
      <TabStrip
        items={openSessions.map((session) => ({
          id: session.id,
          label: session.title,
          icon: session.pinned ? (
            <Pin className="size-2.5 shrink-0 text-accent" />
          ) : undefined,
        }))}
        activeId={chatSessionId}
        onSelect={(id) => {
          const session = byId.get(id);
          if (session) selectSession(session);
        }}
        onClose={(id) => {
          closeChatTab(id);
          onResetChatUi();
        }}
        emptyLabel="No open chats"
        trailing={
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="New chat"
              onClick={() => void newChat()}
            >
              <Plus className="size-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Chat history"
                >
                  <Clock className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>History</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {activeSessions.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No conversations yet
                </p>
              )}
              {activeSessions.map((session) => (
                <HistoryRow
                  key={session.id}
                  session={session}
                  active={session.id === chatSessionId}
                  onOpen={() => selectSession(session)}
                  onTogglePin={() =>
                    update.mutate({
                      sessionId: session.id,
                      patch: { pinned: !session.pinned },
                    })
                  }
                  onToggleArchive={() => {
                    update.mutate({
                      sessionId: session.id,
                      patch: { archived: true },
                    });
                    closeChatTab(session.id);
                    onResetChatUi();
                  }}
                  onRename={() => {
                    setRenameTarget(session);
                    setRenameValue(session.title);
                  }}
                  onDelete={() => setDeleteTarget(session)}
                />
              ))}
              {archivedSessions.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Archived</DropdownMenuLabel>
                  {archivedSessions.map((session) => (
                    <HistoryRow
                      key={session.id}
                      session={session}
                      active={session.id === chatSessionId}
                      onOpen={() => selectSession(session)}
                      onTogglePin={() =>
                        update.mutate({
                          sessionId: session.id,
                          patch: { pinned: !session.pinned },
                        })
                      }
                      onToggleArchive={() =>
                        update.mutate({
                          sessionId: session.id,
                          patch: { archived: false },
                        })
                      }
                      onRename={() => {
                        setRenameTarget(session);
                        setRenameValue(session.title);
                      }}
                      onDelete={() => setDeleteTarget(session)}
                    />
                  ))}
                </>
              )}
            </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <AlertDialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename chat</AlertDialogTitle>
            <AlertDialogDescription>
              Choose a name for this conversation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameTarget && renameValue.trim()) {
                update.mutate({
                  sessionId: renameTarget.id,
                  patch: { title: renameValue.trim() },
                });
                setRenameTarget(null);
              }
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!renameTarget || !renameValue.trim()) return;
                update.mutate({
                  sessionId: renameTarget.id,
                  patch: { title: renameValue.trim() },
                });
                setRenameTarget(null);
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” and all of its messages will be deleted.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              onClick={() => {
                if (!deleteTarget) return;
                remove.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function HistoryRow({
  session,
  active,
  onOpen,
  onTogglePin,
  onToggleArchive,
  onRename,
  onDelete,
}: {
  session: ChatSession;
  active: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-sm px-1 py-0.5",
        active && "bg-muted",
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate px-1 py-1.5 text-left text-sm hover:underline"
        onClick={onOpen}
        title={session.title}
      >
        {session.title}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="shrink-0"
            aria-label="Session actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-40"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem onSelect={onTogglePin}>
            {session.pinned ? (
              <PinOff className="size-3.5" />
            ) : (
              <Pin className="size-3.5" />
            )}
            {session.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleArchive}>
            {session.archived ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
            {session.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              window.setTimeout(onRename, 0);
            }}
          >
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => {
              window.setTimeout(onDelete, 0);
            }}
          >
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
