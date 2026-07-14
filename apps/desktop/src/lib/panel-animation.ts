import type { PanelImperativeHandle } from "react-resizable-panels";
import type { MutableRefObject } from "react";

const EASE_OUT_CUBIC = (t: number) => 1 - (1 - t) ** 3;

/** Cancel a pending rAF-driven panel animation. */
export function cancelPanelAnimation(animRef: MutableRefObject<number | null>) {
  if (animRef.current != null) {
    cancelAnimationFrame(animRef.current);
    animRef.current = null;
  }
}

/**
 * Smoothly resize a panel by calling `resize` each animation frame.
 * CSS transitions on flex-grow are unreliable with react-resizable-panels.
 */
export function animatePanelSize(
  panel: PanelImperativeHandle,
  toPx: number,
  animRef: MutableRefObject<number | null>,
  durationMs = 280,
): Promise<void> {
  cancelPanelAnimation(animRef);

  const from = panel.getSize().inPixels;
  if (Math.abs(from - toPx) < 0.5) {
    panel.resize(toPx);
    return Promise.resolve();
  }

  const start = performance.now();

  return new Promise((resolve) => {
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = EASE_OUT_CUBIC(t);
      panel.resize(Math.round(from + (toPx - from) * eased));
      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        resolve();
      }
    };
    animRef.current = requestAnimationFrame(tick);
  });
}
