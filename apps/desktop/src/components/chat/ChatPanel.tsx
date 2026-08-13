import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage, ChatMode, ChatSession, Citation } from "@nest/shared";
import {
  MessageScroller,
  useMessageScroller,
} from "@shadcn/react/message-scroller";
import { AlertCircle, Check, ChevronDown, FilePenLine, Lightbulb, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AgentStatusIndicator,
  type AgentActivity,
} from "@/components/chat/AgentStatusIndicator";
import { ChatSessionBar } from "@/components/chat/ChatSessionBar";
import { ChatFileChanges } from "@/components/chat/ChatFileChanges";
import { MentionComposer, type MentionRef } from "@/components/chat/MentionComposer";
import { renderWithMentions } from "@/components/chat/mention-pill";
import { collectMentionCandidates } from "@/lib/tree-mentions";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  api,
  listenChatSessionUpdated,
  listenChatStream,
  type ChatStreamEvent,
} from "@/lib/api";
import { appErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { useEditorStore } from "@/stores/editor";

const bubble =
  "min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere]";

export function ChatPanel() {
  const openFileTab = useUiStore((s) => s.openFileTab);
  const setStatusMessage = useUiStore((s) => s.setStatusMessage);
  const sessionId = useUiStore((s) => s.chatSessionId);
  const openChatTab = useUiStore((s) => s.openChatTab);
  const pruneChatTabs = useUiStore((s) => s.pruneChatTabs);
  const queryClient = useQueryClient();
  const setAgentRunActive = useEditorStore((s) => s.setAgentRunActive);
  const setEditing = useEditorStore((s) => s.setEditing);

  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [streamThinking, setStreamThinking] = useState("");
  const [agentActivity, setAgentActivity] = useState<AgentActivity>(null);
  const [liveFileActivities, setLiveFileActivities] = useState<Array<{ path: string; operation: string; staged: boolean }>>([]);
  const [isSending, setIsSending] = useState(false);
  // Session the in-flight mutation actually belongs to, captured at send time.
  // Distinct from `sessionId` (the currently *viewed* tab) so switching tabs
  // mid-generation doesn't leak the streaming UI into a session it isn't for.
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [completedTurn, setCompletedTurn] = useState(0);

  const isGeneratingHere = isSending && pendingSessionId === sessionId;

  const treeQuery = useQuery({
    queryKey: queryKeys.tree,
    queryFn: api.vaultListTree,
  });

  const installedQuery = useQuery({
    queryKey: queryKeys.installedPacks,
    queryFn: api.hubListInstalled,
  });

  const activePackRoots = useMemo(() => {
    const installed = installedQuery.data ?? [];
    const tree = treeQuery.data ?? [];
    const byPath = new Map(installed.map((p) => [p.local_path, p]));
    const roots: string[] = [];
    for (const node of tree) {
      if (node.kind !== "folder") continue;
      const meta = byPath.get(node.path);
      if (!meta || meta.active) roots.push(node.path);
    }
    return roots;
  }, [installedQuery.data, treeQuery.data]);

  const mentionCandidates = useMemo(
    () => collectMentionCandidates(treeQuery.data ?? [], activePackRoots),
    [treeQuery.data, activePackRoots],
  );

  const mentionByName = useMemo(
    () => new Map(mentionCandidates.map((c) => [c.name, c])),
    [mentionCandidates],
  );

  // Buffer tokens and flush once per animation frame — avoids one React render per token.
  const streamBuf = useRef("");
  const thinkingBuf = useRef("");
  const streamRaf = useRef<number | null>(null);

  const flushStream = () => {
    if (streamRaf.current != null) {
      cancelAnimationFrame(streamRaf.current);
      streamRaf.current = null;
    }
    setStreaming(streamBuf.current);
    setStreamThinking(thinkingBuf.current);
  };

  const clearStream = () => {
    if (streamRaf.current != null) {
      cancelAnimationFrame(streamRaf.current);
      streamRaf.current = null;
    }
    streamBuf.current = "";
    thinkingBuf.current = "";
    setStreaming("");
    setStreamThinking("");
  };

  const appendStream = (chunk: string) => {
    streamBuf.current += chunk;
    if (streamRaf.current != null) return;
    streamRaf.current = requestAnimationFrame(() => {
      streamRaf.current = null;
      setStreaming(streamBuf.current);
    });
  };

  const appendThinking = (chunk: string) => {
    thinkingBuf.current += chunk;
    setStreamThinking(thinkingBuf.current);
  };

  const sessionsQuery = useQuery({
    queryKey: queryKeys.chatSessions,
    queryFn: api.chatListSessions,
  });

  const sessions: ChatSession[] = sessionsQuery.data ?? [];
  const mode: ChatMode = sessions.find((session) => session.id === sessionId)?.mode ?? "ask";

  const changeMode = (nextMode: ChatMode) => {
    if (!sessionId || isSending || nextMode === mode) return;
    void api.chatUpdateSession(sessionId, { mode: nextMode }).then((updated) => {
      queryClient.setQueryData<ChatSession[]>(queryKeys.chatSessions, (current) =>
        current?.map((session) => session.id === updated.id ? updated : session),
      );
    }).catch((error: unknown) => setStatusMessage(appErrorMessage(error, "Could not change chat mode")));
  };

  // Called when navigating away from the current tab (new chat, switch, close).
  // Only clears streaming artifacts when nothing is in flight — an in-flight
  // generation belongs to `pendingSessionId`, not whichever tab is active, and
  // must survive the switch so it renders correctly if the user comes back.
  const resetChatUi = () => {
    setChatError(null);
    setIsStopping(false);
    if (!isSending) {
      setPendingUser(null);
      clearStream();
      setAgentActivity(null);
      setLiveFileActivities([]);
    }
  };

  useEffect(() => {
    if (!sessionsQuery.data) return;

    const all = sessionsQuery.data;
    const valid = new Set(all.map((s: ChatSession) => s.id));
    pruneChatTabs(valid);

    const { openChatTabs: tabs, chatSessionId } = useUiStore.getState();
    if (chatSessionId && valid.has(chatSessionId)) {
      if (!tabs.includes(chatSessionId)) openChatTab(chatSessionId);
      return;
    }

    const preferred =
      all.find((s: ChatSession) => !s.archived && tabs.includes(s.id)) ??
      all.find((s: ChatSession) => !s.archived) ??
      all[0];

    if (preferred) {
      openChatTab(preferred.id);
      return;
    }

    void api.chatGetOrCreateInitialSession().then((s) => {
      openChatTab(s.id);
      queryClient.setQueryData<ChatSession[]>(
        queryKeys.chatSessions,
        (current) =>
          current?.some((session) => session.id === s.id)
            ? current
            : [s, ...(current ?? [])],
      );
    });
  }, [
    sessionsQuery.data,
    pruneChatTabs,
    openChatTab,
    queryClient,
  ]);

  const messagesQuery = useQuery({
    queryKey: queryKeys.chatMessages(sessionId ?? ""),
    queryFn: () => api.chatListMessages(sessionId!),
    enabled: !!sessionId,
  });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void listenChatSessionUpdated((updated) => {
      queryClient.setQueryData<ChatSession[]>(
        queryKeys.chatSessions,
        (current) =>
          current?.map((session) =>
            session.id === updated.id ? updated : session,
          ),
      );
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  useEffect(() => {
    return () => {
      if (streamRaf.current != null) cancelAnimationFrame(streamRaf.current);
    };
  }, []);

  const send = useMutation({
    mutationFn: async ({
      sessionId: targetSessionId,
      query,
      focusPaths,
      mode,
      protectedPaths,
    }: {
      sessionId: string;
      query: string;
      focusPaths: string[];
      mode: ChatMode;
      protectedPaths: string[];
    }) => {
      const eventName = `chat-stream-${Date.now()}`;

      const unlisten = await listenChatStream(
        eventName,
        (event: ChatStreamEvent) => {
          if (event.type === "reading") {
            setAgentActivity({ kind: "reading", path: event.path });
          } else if (event.type === "file_editing") {
            setAgentActivity({ kind: "editing", path: event.path });
            setLiveFileActivities((current) => [
              ...current.filter((item) => item.path !== event.path),
              { path: event.path, operation: event.operation, staged: false },
            ]);
          } else if (event.type === "file_staged") {
            setAgentActivity({ kind: "staged", path: event.path });
            setLiveFileActivities((current) => [
              ...current.filter((item) => item.path !== event.path),
              { path: event.path, operation: event.operation, staged: true },
            ]);
          } else if (event.type === "generating") {
            setAgentActivity({ kind: "generating" });
          } else if (event.type === "token") {
            setAgentActivity((prev) =>
              prev?.kind === "generating" ? prev : { kind: "generating" },
            );
            appendStream(event.content);
          } else if (event.type === "thinking") {
            appendThinking(event.content);
          } else if (event.type === "error") {
            setChatError(event.message);
            setStatusMessage(event.message);
          }
        },
      );

      try {
        return await api.chatSend(targetSessionId, query, focusPaths, eventName, mode, protectedPaths);
      } finally {
        unlisten();
      }
    },
    onMutate: ({ sessionId: targetSessionId, query, mode }) => {
      setChatError(null);
      setPendingUser(query);
      setPendingSessionId(targetSessionId);
      setIsSending(true);
      setIsStopping(false);
      clearStream();
      setAgentActivity({ kind: "generating" });
      setLiveFileActivities([]);
      if (mode === "agent") setAgentRunActive(true);
    },
    onSuccess: (assistantMsg, vars) => {
      flushStream();
      // The backend already persisted the user's message before generation
      // started (commands.rs's chat_send inserts it before calling into the
      // agent), so it's never fabricated here — only the assistant reply
      // needs adding. A tab left inactive during generation has a stale
      // cache that doesn't yet contain that user row; reconstructing it from
      // `vars.query` here raced against the tab-switch-triggered background
      // refetch, producing a visible duplicate. Appending just the reply and
      // invalidating (instead of trying to out-guess the DB) lets the next
      // fetch reconcile the cache with the authoritative backend state.
      queryClient.setQueryData<ChatMessage[]>(
        queryKeys.chatMessages(vars.sessionId),
        (old) => {
          const list = old ?? [];
          return list.some((m) => m.id === assistantMsg.id)
            ? list
            : [...list, assistantMsg];
        },
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatMessages(vars.sessionId),
      });
      setPendingUser(null);
      setAgentActivity(null);
      setLiveFileActivities([]);
      setIsSending(false);
      setIsStopping(false);
      setPendingSessionId(null);
      setAgentRunActive(false);
      clearStream();
      if (vars.sessionId === sessionId) {
        setCompletedTurn((current) => current + 1);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allFiles });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allPendingChatFileChanges });
    },
    onError: (error: unknown, vars) => {
      const message = appErrorMessage(error, "Chat request failed");
      if (message.toLowerCase().includes("cancelled")) {
        setIsSending(false);
        setIsStopping(false);
        clearStream();
        setPendingUser(null);
        setAgentActivity(null);
        setLiveFileActivities([]);
        setPendingSessionId(null);
        setAgentRunActive(false);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.chatMessages(vars.sessionId),
        });
        return;
      }
      setChatError(message);
      setStatusMessage(message);
      setIsSending(false);
      setIsStopping(false);
      clearStream();
      setPendingUser(null);
      setAgentActivity(null);
      setLiveFileActivities([]);
      setPendingSessionId(null);
      setAgentRunActive(false);
    },
  });

  const showOptimisticUser =
    isGeneratingHere &&
    pendingUser !== null &&
    !(messagesQuery.data ?? []).some(
      (m: ChatMessage) => m.role === "user" && m.content === pendingUser,
    );

  return (
    <div className="flex h-full flex-col">
      <ChatSessionBar sessions={sessions} onResetChatUi={resetChatUi} />

      <MessageScroller.Provider
        key={sessionId ?? "no-session"}
        autoScroll
        defaultScrollPosition="last-anchor"
        scrollPreviousItemPeek={48}
      >
        <ChatCompletionScroll completedTurn={completedTurn} />
        <MessageScroller.Root className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <MessageScroller.Viewport className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/20">
            <MessageScroller.Content
              aria-busy={isGeneratingHere}
              className="flex min-w-0 max-w-full flex-col gap-4 overflow-x-hidden px-3 pt-3 pb-8"
            >
          {(messagesQuery.data ?? []).map((msg: ChatMessage) => (
            <MessageScroller.Item
              key={msg.id}
              messageId={msg.id}
              scrollAnchor={msg.role === "user"}
              className="min-w-0 space-y-2 [content-visibility:auto] [contain-intrinsic-size:auto_80px]"
            >
              {msg.role === "user" ? (
                <UserBubble content={msg.content} mentions={mentionByName} />
              ) : (
                <AssistantBubble>
                  {msg.thinking && (
                    <div className="mb-3">
                      <ThinkingDisclosure
                        content={msg.thinking}
                        seconds={msg.thinking_seconds}
                      />
                    </div>
                  )}
                  <MarkdownBody className={bubble}>{msg.content}</MarkdownBody>
                  {msg.file_changes && <ChatFileChanges changes={msg.file_changes} onReview={(path) => {
                    openFileTab(path, { preview: false });
                    setEditing(path, true);
                  }} />}
                  {msg.citations && msg.citations.length > 0 && (
                    <References
                      citations={msg.citations}
                      onOpen={(path) => openFileTab(path)}
                    />
                  )}
                </AssistantBubble>
              )}
            </MessageScroller.Item>
          ))}

          {showOptimisticUser && (
            <MessageScroller.Item
              messageId="pending-user"
              scrollAnchor
              className="min-w-0"
            >
              <UserBubble content={pendingUser ?? ""} mentions={mentionByName} />
            </MessageScroller.Item>
          )}

          {isGeneratingHere && (
            <MessageScroller.Item
              messageId="streaming-assistant"
              className="min-w-0"
            >
              <AssistantBubble>
                {liveFileActivities.length > 0 && (
                  <LiveFileActivities activities={liveFileActivities} />
                )}
                {streaming ? (
                  <>
                    {agentActivity?.kind === "reading" && (
                      <AgentStatusIndicator activity={agentActivity} />
                    )}
                    <p className={cn(bubble, "text-sm leading-relaxed whitespace-pre-wrap")}>
                      {streaming}
                      <span
                        aria-hidden
                        className="ml-0.5 inline-block h-[1em] w-1.5 translate-y-[0.1em] animate-pulse rounded-sm bg-foreground/50 align-baseline"
                      />
                    </p>
                    {streamThinking && (
                      <ThinkingDisclosure content={streamThinking} isStreaming />
                    )}
                  </>
                ) : (
                  <>
                    <AgentStatusIndicator
                      activity={agentActivity ?? { kind: "generating" }}
                    />
                    {streamThinking && (
                      <ThinkingDisclosure content={streamThinking} isStreaming />
                    )}
                  </>
                )}
              </AssistantBubble>
            </MessageScroller.Item>
          )}

          {chatError && (
            <MessageScroller.Item messageId="chat-error" className="min-w-0">
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Chat failed</p>
                  <p className="mt-0.5 break-words text-xs opacity-90">{chatError}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-destructive/70 hover:text-destructive"
                  onClick={() => setChatError(null)}
                  aria-label="Dismiss error"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </MessageScroller.Item>
          )}
            </MessageScroller.Content>
          </MessageScroller.Viewport>
          <MessageScroller.Button
            direction="end"
            className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-md backdrop-blur transition-[opacity,color] hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:opacity-0"
          >
            <ChevronDown className="size-3.5" />
            Latest
          </MessageScroller.Button>
        </MessageScroller.Root>
      </MessageScroller.Provider>

      <div className="shrink-0 px-3 pb-3 pt-4">
        <MentionComposer
          candidates={mentionCandidates}
          isGenerating={isGeneratingHere}
          canSend={!!sessionId && !isSending}
          onSend={(query, focusPaths) => {
            if (!sessionId) return;
            send.mutate({
              sessionId,
              query,
              focusPaths,
              mode,
              protectedPaths: Array.from(useEditorStore.getState().editingPaths),
            });
          }}
          mode={mode}
          onModeChange={changeMode}
          onStop={() => {
            if (isStopping) return;
            setIsStopping(true);
            void api.chatCancel().catch((e: unknown) => {
              setIsStopping(false);
              const message = e instanceof Error ? e.message : String(e);
              setChatError(`Could not stop generation: ${message}`);
            });
          }}
        />
      </div>
    </div>
  );
}

function LiveFileActivities({ activities }: { activities: Array<{ path: string; operation: string; staged: boolean }> }) {
  return (
    <div className="mb-3 space-y-1 rounded-md bg-muted/45 p-2 text-xs">
      {activities.map((activity) => (
        <div key={activity.path} className="flex min-w-0 items-center gap-2">
          {activity.staged ? <Check className="size-3.5 shrink-0 text-success" /> : <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />}
          <FilePenLine className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono">{activity.path}</span>
          <span className="shrink-0 capitalize text-muted-foreground">{activity.staged ? "staged" : activity.operation}</span>
        </div>
      ))}
    </div>
  );
}

function ChatCompletionScroll({
  completedTurn,
}: {
  completedTurn: number;
}) {
  const { scrollToEnd } = useMessageScroller();
  const previousCompletedTurn = useRef(completedTurn);

  useEffect(() => {
    if (completedTurn === previousCompletedTurn.current) return;
    previousCompletedTurn.current = completedTurn;
    const frame = requestAnimationFrame(() => {
      scrollToEnd({ behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [completedTurn, scrollToEnd]);

  return null;
}

function UserBubble({
  content,
  mentions,
}: {
  content: string;
  mentions: Map<string, MentionRef>;
}) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          bubble,
          "max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap",
        )}
      >
        {renderWithMentions(content, mentions)}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return <div className={bubble}>{children}</div>;
}

function ThinkingDisclosure({
  content,
  seconds,
  isStreaming = false,
}: {
  content: string;
  seconds?: number;
  isStreaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = isStreaming
    ? "Thinking…"
    : `Thought for ${(seconds ?? 0).toFixed(1)} seconds`;

  return (
    <div className="mt-3 border-t border-border/60 pt-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Lightbulb className="size-3.5" />
        <span>{label}</span>
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="mt-2 h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 text-xs leading-relaxed text-muted-foreground">
          {content}
        </pre>
      )}
    </div>
  );
}

function References({
  citations,
  onOpen,
}: {
  citations: Citation[];
  onOpen: (path: string) => void;
}) {
  return (
    <Accordion
      type="single"
      collapsible
      className="mt-3"
    >
      <AccordionItem value="references" className="border-none">
        <AccordionTrigger className="justify-start py-1 text-xs font-medium text-muted-foreground hover:no-underline hover:text-foreground">
          <span>Found {citations.length} references</span>
        </AccordionTrigger>
        <AccordionContent className="pb-2">
          <ul className="space-y-1.5">
            {citations.map((c, i) => (
              <li key={c.chunk_id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.file_path)}
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      [{i + 1}] {c.title || c.file_path}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {c.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {c.snippet}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-accent">
                    {c.file_path}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
