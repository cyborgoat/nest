import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Citation } from "@nest/shared";
import { AlertCircle, MessageSquare, Send, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { api, listenChatStream, type ChatStreamEvent } from "@/lib/api";
import { useUiStore } from "@/stores/ui";

export function ChatPanel() {
  const selectedScope = useUiStore((s) => s.selectedScope);
  const clearScope = useUiStore((s) => s.clearScope);
  const setSelectedPath = useUiStore((s) => s.setSelectedPath);
  const setStatusMessage = useUiStore((s) => s.setStatusMessage);
  const queryClient = useQueryClient();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [liveCitations, setLiveCitations] = useState<Citation[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sessionsQuery = useQuery({
    queryKey: ["chat-sessions"],
    queryFn: api.chatListSessions,
  });

  useEffect(() => {
    if (sessionId || !sessionsQuery.data) return;
    if (sessionsQuery.data.length > 0) {
      setSessionId(sessionsQuery.data[0].id);
      return;
    }
    api.chatCreateSession("Library chat").then((s) => {
      setSessionId(s.id);
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    });
  }, [sessionId, sessionsQuery.data, queryClient]);

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", sessionId],
    queryFn: () => api.chatListMessages(sessionId!),
    enabled: !!sessionId,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data, pendingUser, streaming, liveCitations, chatError]);

  const scopeLabel = useMemo(() => {
    if (selectedScope.length === 0) return "Whole library";
    if (selectedScope.length === 1) return selectedScope[0];
    return `${selectedScope.length} scoped paths`;
  }, [selectedScope]);

  const send = useMutation({
    mutationFn: async (query: string) => {
      if (!sessionId) throw new Error("No chat session");
      const eventName = `chat-stream-${Date.now()}`;

      const unlisten = await listenChatStream(eventName, (event: ChatStreamEvent) => {
        if (event.type === "citations") {
          setLiveCitations(event.citations);
        } else if (event.type === "token") {
          setStreaming((prev) => prev + event.content);
        } else if (event.type === "error") {
          setChatError(event.message);
          setStatusMessage(event.message);
        }
      });

      try {
        return await api.chatSend(sessionId, query, selectedScope, eventName);
      } finally {
        unlisten();
      }
    },
    onMutate: (query) => {
      setChatError(null);
      setPendingUser(query);
      setInput("");
      setIsSending(true);
      setStreaming("");
      setLiveCitations([]);
    },
    onSuccess: () => {
      setPendingUser(null);
      setLiveCitations([]);
      queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
    },
    onError: (e: Error) => {
      const message = e.message || "Chat request failed";
      setChatError(message);
      setStatusMessage(message);
    },
    onSettled: () => {
      setIsSending(false);
      setStreaming("");
      setPendingUser(null);
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ["chat-messages", sessionId] });
      }
    },
  });

  const newChat = async () => {
    const session = await api.chatCreateSession(
      input.trim().slice(0, 40) || "New chat",
    );
    setSessionId(session.id);
    setPendingUser(null);
    setLiveCitations([]);
    setStreaming("");
    setChatError(null);
    queryClient.invalidateQueries({ queryKey: ["chat-sessions"] });
  };

  const showOptimisticUser =
    pendingUser !== null &&
    !(messagesQuery.data ?? []).some(
      (m) => m.role === "user" && m.content === pendingUser,
    );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-primary" />
          <h3 className="text-sm font-medium">Chat</h3>
        </div>
        <Button size="sm" variant="ghost" onClick={newChat}>
          New
        </Button>
      </div>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <Sparkles className="size-3.5 text-accent" />
        <span className="text-muted-foreground">Scope:</span>
        <span className="truncate font-medium">{scopeLabel}</span>
        {selectedScope.length > 0 && (
          <button
            type="button"
            onClick={clearScope}
            className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" /> Clear
          </button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
          {(messagesQuery.data ?? []).map((msg) => (
            <div key={msg.id} className="space-y-2">
              <div
                className={
                  msg.role === "user"
                    ? "ml-6 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "mr-2 rounded-lg bg-muted px-3 py-2 text-sm"
                }
              >
                {msg.content}
              </div>
              {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                <References
                  citations={msg.citations}
                  onOpen={(path) => setSelectedPath(path)}
                />
              )}
            </div>
          ))}

          <AnimatePresence>
            {showOptimisticUser && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="ml-6 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
              >
                {pendingUser}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isSending && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                {liveCitations.length > 0 && (
                  <References
                    citations={liveCitations}
                    onOpen={(path) => setSelectedPath(path)}
                  />
                )}
                <div className="mr-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  {streaming || "Thinking…"}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

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

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your knowledge…"
            className="min-h-[72px] resize-none"
            disabled={isSending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !isSending) send.mutate(input.trim());
              }
            }}
          />
          <Button
            size="icon"
            className="h-[72px] w-10 shrink-0"
            disabled={!input.trim() || isSending || !sessionId}
            onClick={() => send.mutate(input.trim())}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
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
    <div className="rounded-md border border-border bg-panel p-2">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        References
      </p>
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
              <p className="mt-0.5 truncate text-[10px] text-accent">{c.file_path}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
