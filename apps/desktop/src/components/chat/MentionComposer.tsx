import { ArrowUp, FileText, Folder, Square, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MentionRef = {
  path: string;
  kind: "file" | "folder";
  name: string;
};

type Candidate = MentionRef;

type Props = {
  candidates: Candidate[];
  isGenerating?: boolean;
  onSend: (text: string, focusPaths: string[]) => void;
  onStop?: () => void;
  canSend: boolean;
};

export function MentionComposer({
  candidates,
  isGenerating = false,
  onSend,
  onStop,
  canSend,
}: Props) {
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<MentionRef[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filtered = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    return candidates
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.path.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [candidates, mentionQuery]);

  useEffect(() => {
    setHighlight(0);
  }, [mentionQuery, filtered.length]);

  const updateMentionFromText = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const at = before.lastIndexOf("@");
    if (at < 0) {
      setMentionQuery(null);
      return;
    }
    const prev = at === 0 ? " " : before[at - 1];
    if (prev && !/\s/.test(prev)) {
      setMentionQuery(null);
      return;
    }
    const frag = before.slice(at + 1);
    if (/\s/.test(frag)) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(frag);
  };

  const insertRef = (c: Candidate) => {
    const el = textareaRef.current;
    const value = text;
    const cursor = el?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const at = before.lastIndexOf("@");
    if (at < 0) return;
    const prefix = before.slice(0, at);
    const suffix = value.slice(cursor);
    const token = `@${c.name}`;
    const separator = suffix.startsWith(" ") ? "" : " ";
    const nextText = `${prefix}${token}${separator}${suffix}`;
    setText(nextText);
    setRefs((prev) =>
      prev.some((r) => r.path === c.path) ? prev : [...prev, c],
    );
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = prefix.length + token.length + separator.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const trySend = () => {
    const body = text.trim();
    if ((!body && refs.length === 0) || !canSend || isGenerating) return;
    onSend(
      body,
      refs.map((ref) => ref.path),
    );
    setText("");
    setRefs([]);
    setMentionQuery(null);
    setScrollTop(0);
  };

  const hasContent = text.trim().length > 0 || refs.length > 0;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    if (e.key === "Backspace") {
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const mention = findMentionForBackspace(text, refs, start, end);
      if (mention) {
        e.preventDefault();
        const deletion = removeMentionRange(text, mention.start, mention.end);
        setText(deletion.text);
        setRefs((current) =>
          current.filter((ref) =>
            deletion.text.includes(mentionToken(ref)),
          ),
        );
        setMentionQuery(null);
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(
            deletion.cursor,
            deletion.cursor,
          );
        });
        return;
      }
    }

    if (mentionQuery != null && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertRef(filtered[highlight]!);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      trySend();
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "relative min-h-[76px] rounded-lg border border-border bg-card px-2.5 pt-2.5 pb-10 shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/15",
        )}
      >
        {refs.length > 0 && (
          <div className="mb-1.5 flex w-full min-w-0 flex-row flex-wrap content-start items-center gap-1.5 pr-8">
            {refs.map((ref) => (
              <span
                key={ref.path}
                className="flex h-6 w-auto min-w-0 max-w-full flex-none basis-auto items-center gap-1 whitespace-nowrap rounded-md border border-primary/15 bg-primary/[0.06] pl-2 pr-1 text-xs font-medium text-foreground"
                title={ref.path}
              >
                {ref.kind === "folder" ? (
                  <Folder className="size-3 shrink-0 text-accent-text" />
                ) : (
                  <FileText className="size-3 shrink-0 text-accent-text" />
                )}
                <span className="min-w-0 max-w-40 truncate">{ref.name}</span>
                <button
                  type="button"
                  className="ml-0.5 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
                  aria-label={`Remove ${ref.name}`}
                  onClick={() => {
                    setRefs((current) =>
                      current.filter((item) => item.path !== ref.path),
                    );
                    setText((current) => removeMentionToken(current, ref));
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          {text && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden pr-8 text-sm leading-5 whitespace-pre-wrap break-words text-foreground"
            >
              <div style={{ transform: `translateY(-${scrollTop}px)` }}>
                {renderMentionHighlights(text, refs)}
              </div>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            disabled={isGenerating}
            placeholder="Ask anything…"
            rows={2}
            className="relative block w-full resize-none bg-transparent pr-8 text-sm leading-5 text-transparent caret-foreground outline-none selection:bg-primary/20 selection:text-foreground placeholder:text-muted-foreground"
            onChange={(e) => {
              const value = e.target.value;
              setText(value);
              setRefs((current) =>
                current.filter((ref) => value.includes(mentionToken(ref))),
              );
              updateMentionFromText(value, e.target.selectionStart);
            }}
            onClick={(e) => {
              updateMentionFromText(
                e.currentTarget.value,
                e.currentTarget.selectionStart,
              );
            }}
            onKeyUp={(e) => {
              updateMentionFromText(
                e.currentTarget.value,
                e.currentTarget.selectionStart,
              );
            }}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            onKeyDown={onKeyDown}
          />
        </div>
        {isGenerating ? (
          <Button
            size="icon-sm"
            variant="secondary"
            className="absolute right-2 bottom-2 opacity-100"
            disabled={false}
            onClick={onStop}
            aria-label="Stop generation"
            title="Stop"
          >
            <Square className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            className="absolute right-2 bottom-2"
            disabled={!hasContent || !canSend || isGenerating}
            onClick={trySend}
            aria-label="Send"
            title="Send"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        )}
      </div>

      {mentionQuery != null && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
          {candidates.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Activate a pack in the Library to @ mention files or folders.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No matches for “{mentionQuery}”
            </p>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.path}
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  i === highlight ? "bg-muted" : "hover:bg-muted/70",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertRef(c);
                }}
              >
                {c.kind === "folder" ? (
                  <Folder className="size-3.5 shrink-0 text-accent" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-primary" />
                )}
                <span className="min-w-0 truncate">
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {c.path}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function mentionToken(ref: MentionRef) {
  return `@${ref.name}`;
}

function removeMentionToken(text: string, ref: MentionRef) {
  const token = mentionToken(ref);
  return text
    .replace(new RegExp(escapeRegExp(token), "g"), "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^ | $/g, "");
}

function renderMentionHighlights(text: string, refs: MentionRef[]) {
  const tokens = refs
    .map(mentionToken)
    .sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return text;
  const tokenSet = new Set(tokens);
  const matcher = new RegExp(
    `(${tokens.map((token) => escapeRegExp(token)).join("|")})`,
    "g",
  );
  return text.split(matcher).map((part, index) =>
    tokenSet.has(part) ? (
      <span
        key={`${part}-${index}`}
        className="rounded-sm bg-primary/[0.12] text-foreground"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function findMentionForBackspace(
  text: string,
  refs: MentionRef[],
  selectionStart: number,
  selectionEnd: number,
) {
  const tokens = [...new Set(refs.map(mentionToken))].sort(
    (a, b) => b.length - a.length,
  );
  if (tokens.length === 0) return null;

  const matcher = new RegExp(
    tokens.map((token) => escapeRegExp(token)).join("|"),
    "g",
  );
  for (const match of text.matchAll(matcher)) {
    const start = match.index;
    const end = start + match[0].length;
    const caretTouchesMention =
      selectionStart === selectionEnd &&
      ((selectionStart > start && selectionStart <= end) ||
        (selectionStart === end + 1 && text[end] === " "));
    const selectionTouchesMention =
      selectionStart !== selectionEnd &&
      selectionStart < end &&
      selectionEnd > start;

    if (caretTouchesMention || selectionTouchesMention) {
      return { start, end };
    }
  }
  return null;
}

function removeMentionRange(text: string, mentionStart: number, mentionEnd: number) {
  let start = mentionStart;
  let end = mentionEnd;
  if (text[end] === " ") {
    end += 1;
  } else if (start > 0 && text[start - 1] === " ") {
    start -= 1;
  }
  return {
    text: text.slice(0, start) + text.slice(end),
    cursor: start,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
