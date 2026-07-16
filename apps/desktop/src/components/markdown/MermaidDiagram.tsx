import { useEffect, useRef, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
      });
      return mod.default;
    });
  }
  return mermaidPromise;
}

let counter = 0;

export function MermaidDiagram({ code }: { code: string }) {
  const idRef = useRef(`mermaid-${++counter}`);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    loadMermaid()
      .then((mermaid) => mermaid.render(idRef.current, code))
      .then((result) => {
        if (!cancelled) setSvg(result.svg);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <pre className="mermaid-error">Failed to render diagram: {error}</pre>
    );
  }

  if (!svg) {
    return <div className="mermaid-loading">Rendering diagram…</div>;
  }

  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
