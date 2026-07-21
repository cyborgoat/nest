import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage, ChatSession, Citation } from "@nest/shared";
import { AlertCircle, ChevronDown, FileText, Folder, Lightbulb, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AgentStatusIndicator,
  type AgentActivity,
} from "@/components/chat/AgentStatusIndicator";
import { ChatSessionBar } from "@/components/chat/ChatSessionBar";
import { MentionComposer, type MentionRef } from "@/components/chat/MentionComposer";
import { collectMentionCandidates } from "@/components/library/LibraryTree";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, listenChatStream, type ChatStreamEvent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const bubble =
  "min-w-0 max-w-full overflow-hidden break-words [overflow-wrap:anywhere]";

export function ChatPanel() {
  const openFileTab = useUiStore((s) => s.openFileTab);
  const setStatusMessage = useUiStore((s) => s.setStatusMessage);
  const sessionId = useUiStore((s) => s.chatSessionId);
  const openChatTab = useUiStore((s) => s.openChatTab);
  const pruneChatTabs = useUiStore((s) => s.pruneChatTabs);
  const queryClient = useQueryClient();

  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [streamThinking, setStreamThinking] = useState("");
  const [agentActivity, setAgentActivity] = useState<AgentActivity>(null);
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);

  const treeQuery = useQuery({
    queryKey: ["tree"],
    queryFn: api.vaultListTree,
  });

  const installedQuery = useQuery({
    queryKey: ["installed-packs"],
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
    queryKey: ["chat-sessions"],
    queryFn: api.chatListSessions,
  });

  const sessions: ChatSession[] = sessionsQuery.data ?? [];

  const resetChatUi = () => {
    setPendingUser(null);
    clearStream();
    setAgentActivity(null);
    setChatError(null);
    setIsStopping(false);
  };

  useEffect(() => {
    if (!sessionsQuery.data || bootstrapped.current) return;
    bootstrapped.current = true;

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

    void api.chatCreateSession("New chat").then((s) => {
      openChatTab(s.id);
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    });
  }, [sessionsQuery.data, pruneChatTabs, openChatTab, queryClient]);

  useEffect(() => {
    if (!sessionsQuery.data || !bootstrapped.current) return;
    if (sessionId) return;

    const preferred = sessionsQuery.data.find((s: ChatSession) => !s.archived);
    if (preferred) {
      openChatTab(preferred.id);
      return;
    }
    void api.chatCreateSession("New chat").then((s) => {
      openChatTab(s.id);
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    });
  }, [sessionId, sessionsQuery.data, openChatTab, queryClient]);

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", sessionId],
    queryFn: () => api.chatListMessages(sessionId!),
    enabled: !!sessionId,
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => cancelAnimationFrame(id);
  }, [messagesQuery.data, pendingUser, streaming, chatError, agentActivity]);

  useEffect(() => {
    return () => {
      if (streamRaf.current != null) cancelAnimationFrame(streamRaf.current);
    };
  }, []);

  const send = useMutation({
    mutationFn: async ({
      query,
      focusPaths,
    }: {
      query: string;
      focusPaths: string[];
    }) => {
      if (!sessionId) throw new Error("No chat session");
      const eventName = `chat-stream-${Date.now()}`;

      const unlisten = await listenChatStream(
        eventName,
        (event: ChatStreamEvent) => {
          if (event.type === "reading") {
            setAgentActivity({ kind: "reading", path: event.path });
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
        return await api.chatSend(sessionId, query, focusPaths, eventName);
      } finally {
        unlisten();
      }
    },
    onMutate: ({ query }) => {
      setChatError(null);
      setPendingUser(query);
      setIsSending(true);
      setIsStopping(false);
      clearStream();
      setAgentActivity({ kind: "generating" });
    },
    onSuccess: (assistantMsg, vars) => {
      flushStream();
      if (sessionId) {
        queryClient.setQueryData<ChatMessage[]>(
          ["chat-messages", sessionId],
          (old) => {
            const list = [...(old ?? [])];
            if (
              !list.some((m) => m.role === "user" && m.content === vars.query)
            ) {
              list.push({
                id: `local-user-${Date.now()}`,
                role: "user",
                content: vars.query,
                created_at: new Date().toISOString(),
              });
            }
            if (!list.some((m) => m.id === assistantMsg.id)) {
              list.push(assistantMsg);
            }
            return list;
          },
        );
      }
      setPendingUser(null);
      setAgentActivity(null);
      setIsSending(false);
      setIsStopping(false);
      clearStream();
      void queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    },
    onError: (e: Error) => {
      const message = e.message || "Chat request failed";
      if (message.toLowerCase().includes("cancelled")) {
        setIsSending(false);
        setIsStopping(false);
        clearStream();
        setPendingUser(null);
        setAgentActivity(null);
        if (sessionId) {
          void queryClient.invalidateQueries({
            queryKey: ["chat-messages", sessionId],
          });
        }
        return;
      }
      setChatError(message);
      setStatusMessage(message);
      setIsSending(false);
      setIsStopping(false);
      clearStream();
      setPendingUser(null);
      setAgentActivity(null);
    },
  });

  const showOptimisticUser =
    pendingUser !== null &&
    !(messagesQuery.data ?? []).some(
      (m: ChatMessage) => m.role === "user" && m.content === pendingUser,
    );

  return (
    <div className="flex h-full flex-col">
      <ChatSessionBar sessions={sessions} onResetChatUi={resetChatUi} />

      <ScrollArea className="flex-1 min-h-0">
        <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden px-3 pt-3 pb-8">
          {(messagesQuery.data ?? []).map((msg: ChatMessage) => (
            <div key={msg.id} className="min-w-0 space-y-2">
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
                  {msg.citations && msg.citations.length > 0 && (
                    <References
                      citations={msg.citations}
                      onOpen={(path) => openFileTab(path)}
                    />
                  )}
                </AssistantBubble>
              )}
            </div>
          ))}

          {showOptimisticUser && (
            <UserBubble content={pendingUser ?? ""} mentions={mentionByName} />
          )}

          {isSending && (
            <AssistantBubble>
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
          )}

          {chatError && (
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
          )}

          <div ref={bottomRef} className="h-4" />
        </div>
      </ScrollArea>

      <div className="shrink-0 px-3 pb-3 pt-4">
        <MentionComposer
          candidates={mentionCandidates}
          isGenerating={isSending}
          canSend={!!sessionId && !isSending}
          placeholders={{
            emptyActive:
              "Type a message… Activate a pack to use @ mentions.",
            ready:
              "Type a message… Enter to send; Shift+Enter for a new line; @ to mention files or folders.",
          }}
          onSend={(query, focusPaths) => send.mutate({ query, focusPaths })}
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

function renderWithMentions(content: string, mentions: Map<string, MentionRef>) {
  return content.split(/(@[^\s]+)/g).map((part, i) => {
    const ref = part.startsWith("@") ? mentions.get(part.slice(1)) : undefined;
    if (!ref) return part;
    return (
      <span
        key={i}
        className="mx-0.5 inline-flex max-w-[10rem] items-center gap-1 rounded-full bg-primary-foreground/15 px-1.5 py-0.5 align-middle text-[11px] font-medium"
        title={ref.path}
      >
        {ref.kind === "folder" ? (
          <Folder className="size-2.5 shrink-0" />
        ) : (
          <FileText className="size-2.5 shrink-0" />
        )}
        <span className="truncate">{ref.name}</span>
      </span>
    );
  });
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
