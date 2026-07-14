import { useEffect, useRef, useState } from "react";
import { TextEffect } from "@/components/motion-primitives/text-effect";

/**
 * Animate only the newest tail of streaming text with TextEffect,
 * keeping the settled prefix static so earlier words don't re-animate.
 */
export function StreamingTextEffect({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [settled, setSettled] = useState("");
  const [fresh, setFresh] = useState(text);
  const settledLen = useRef(0);

  useEffect(() => {
    if (text.length < settledLen.current) {
      settledLen.current = 0;
      setSettled("");
      setFresh(text);
      return;
    }

    // Promote all but the latest ~3 word segments into the settled prefix.
    const parts = text.slice(settledLen.current).split(/(\s+)/);
    if (parts.length <= 6) {
      setFresh(text.slice(settledLen.current));
      return;
    }

    const promote = parts.slice(0, -4).join("");
    const nextSettled = text.slice(0, settledLen.current) + promote;
    settledLen.current = nextSettled.length;
    setSettled(nextSettled);
    setFresh(text.slice(nextSettled.length));
  }, [text]);

  return (
    <div className={className}>
      {settled ? (
        <span className="whitespace-pre-wrap text-sm leading-relaxed">{settled}</span>
      ) : null}
      {fresh ? (
        <TextEffect
          key={`fresh-${settled.length}`}
          as="span"
          per="word"
          preset="fade"
          speedReveal={4}
          speedSegment={2}
          className="inline text-sm leading-relaxed whitespace-pre-wrap"
        >
          {fresh}
        </TextEffect>
      ) : null}
    </div>
  );
}
