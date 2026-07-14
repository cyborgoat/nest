import { useEffect, useRef, useState } from "react";
import { TextEffect } from "@/components/motion-primitives/text-effect";

type Chunk = { id: number; text: string };

/**
 * Streams with motion-primitives TextEffect on each newly finished chunk.
 * Committed chunks stay mounted so earlier words do not remount/re-animate.
 */
export function StreamingTextEffect({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [tail, setTail] = useState("");
  const nextId = useRef(0);
  const committedRef = useRef("");

  useEffect(() => {
    const committed = committedRef.current;

    // New turn / replaced content
    if (committed && !text.startsWith(committed)) {
      committedRef.current = "";
      nextId.current = 0;
      setChunks([]);
      setTail(text);
      return;
    }

    const incoming = text.slice(committed.length);
    const parts = incoming.split(/(\s+)/);

    // Still building the first/last unfinished token — keep as plain tail.
    if (parts.length < 2) {
      setTail(incoming);
      return;
    }

    const completeParts = parts.slice(0, -1);
    const rest = parts[parts.length - 1] ?? "";
    const toCommit = completeParts.join("");
    if (!toCommit) {
      setTail(rest);
      return;
    }

    const id = nextId.current++;
    committedRef.current = committed + toCommit;
    setChunks((prev) => [...prev, { id, text: toCommit }]);
    setTail(rest);
  }, [text]);

  return (
    <div className={className ?? "text-sm leading-relaxed"}>
      {chunks.map((chunk) => (
        <TextEffect
          key={chunk.id}
          as="span"
          per="word"
          preset="fade"
          speedReveal={7}
          speedSegment={3}
          className="inline text-sm leading-relaxed"
          segmentWrapperClassName="inline"
        >
          {chunk.text}
        </TextEffect>
      ))}
      {tail ? (
        <span className="inline whitespace-pre-wrap text-sm leading-relaxed">
          {tail}
        </span>
      ) : null}
    </div>
  );
}
