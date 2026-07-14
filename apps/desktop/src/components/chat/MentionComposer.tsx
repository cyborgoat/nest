import { FileText, Folder, Send, X } from "lucide-react";
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
  disabled?: boolean;
  placeholders?: { emptyActive: string; ready: string };
  onSend: (text: string, focusPaths: string[]) => void;
  canSend: boolean;
};

export function MentionComposer({
  candidates,
  disabled,
  placeholders,
  onSend,
  canSend,
}: Props) {
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<MentionRef[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
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
    const nextText = before.slice(0, at) + value.slice(cursor);
    setText(nextText);
    setRefs((prev) =>
      prev.some((r) => r.path === c.path) ? prev : [...prev, c],
    );
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at;
      el?.setSelectionRange(pos, pos);
    });
  };

  const removeRef = (path: string) => {
    setRefs((prev) => prev.filter((r) => r.path !== path));
  };

  const trySend = () => {
    const trimmed = text.trim();
    if ((!trimmed && refs.length === 0) || !canSend || disabled) return;
    const focusPaths = refs.map((r) => r.path);
    const label =
      refs.length === 0
        ? trimmed
        : trimmed
          ? `${trimmed}\n\n(focus: ${refs.map((r) => r.path).join(", ")})`
          : `Focus: ${refs.map((r) => r.path).join(", ")}`;
    onSend(label, focusPaths);
    setText("");
    setRefs([]);
    setMentionQuery(null);
  };

  const hasContent = text.trim().length > 0 || refs.length > 0;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

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

    if (e.key === "Backspace" && text === "" && refs.length > 0) {
      e.preventDefault();
      setRefs((prev) => prev.slice(0, -1));
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      trySend();
    }
  };

  const placeholder =
    candidates.length === 0
      ? (placeholders?.emptyActive ??
        "Activate a pack in the Library to chat and use @…")
      : (placeholders?.ready ??
        "Ask about your knowledge… (@ for files/folders)");

  return (
    <div className="relative">
      <div
        className={cn(
          "relative min-h-[72px] rounded-md border border-border bg-card px-2 pt-2 pb-9",
          disabled && "opacity-60",
        )}
      >
        {refs.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {refs.map((r) => (
              <span
                key={r.path}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground"
                title={r.path}
              >
                {r.kind === "folder" ? (
                  <Folder className="size-3 shrink-0 text-accent" />
                ) : (
                  <FileText className="size-3 shrink-0 text-primary" />
                )}
                <span className="truncate">{r.name}</span>
                <button
                  type="button"
                  className="shrink-0 rounded-full p-0.5 hover:bg-background"
                  onClick={() => removeRef(r.path)}
                  aria-label={`Remove ${r.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          rows={2}
          className="w-full resize-none bg-transparent pr-8 text-sm outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
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
          onKeyDown={onKeyDown}
        />
        <Button
          size="icon"
          className="absolute right-2 bottom-2 size-7"
          disabled={!hasContent || !canSend || disabled}
          onClick={trySend}
          aria-label="Send"
          title="Send"
        >
          <Send className="size-3.5" />
        </Button>
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
