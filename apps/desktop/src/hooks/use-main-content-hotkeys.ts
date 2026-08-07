import { useEffect } from "react";
import { useUiStore } from "@/stores/ui";

const ZOOM_IN_KEYS = new Set(["+", "="]);
const ZOOM_OUT_KEYS = new Set(["-", "_"]);

/** Global content-view shortcuts: Ctrl/Cmd+Plus/Minus/0 to zoom, Ctrl/Cmd+W
 * to close the active tab. Deliberately not scoped to a focused container —
 * these should work regardless of what has focus, same as a browser. */
export function useMainContentHotkeys(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (ZOOM_IN_KEYS.has(e.key)) {
        e.preventDefault();
        useUiStore.getState().zoomIn();
      } else if (ZOOM_OUT_KEYS.has(e.key)) {
        e.preventDefault();
        useUiStore.getState().zoomOut();
      } else if (e.key === "0") {
        e.preventDefault();
        useUiStore.getState().resetContentZoom();
      } else if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        const { activeMainTabId, requestCloseMainTab } = useUiStore.getState();
        if (activeMainTabId) requestCloseMainTab(activeMainTabId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
