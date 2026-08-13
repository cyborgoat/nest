import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useUiStore } from "@/stores/ui";

const ZOOM_IN_KEYS = new Set(["+", "="]);
const ZOOM_OUT_KEYS = new Set(["-", "_"]);

const WHEEL_ZOOM_THRESHOLD = 50;

/** Browser-style whole-app zoom and active-tab shortcuts. */
export function useAppHotkeys(): void {
  const appZoom = useUiStore((state) => state.appZoom);

  useEffect(() => {
    if (isTauri()) {
      void getCurrentWebview()
        .setZoom(appZoom)
        .catch((error: unknown) =>
          console.error("Could not apply app zoom", error),
        );
      return;
    }
    // Keep Vite/browser development behavior aligned with the Tauri webview.
    document.documentElement.style.setProperty("zoom", String(appZoom));
  }, [appZoom]);

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
        useUiStore.getState().resetAppZoom();
      } else if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        const { activeMainTabId, requestCloseMainTab } = useUiStore.getState();
        if (activeMainTabId) requestCloseMainTab(activeMainTabId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    let accumulated = 0;
    const handleWheel = (e: WheelEvent) => {
      // Trackpad pinch-to-zoom is delivered as a ctrl+wheel event.
      if (!e.ctrlKey) return;
      e.preventDefault();
      accumulated += e.deltaY;
      while (Math.abs(accumulated) >= WHEEL_ZOOM_THRESHOLD) {
        if (accumulated > 0) {
          useUiStore.getState().zoomOut();
          accumulated -= WHEEL_ZOOM_THRESHOLD;
        } else {
          useUiStore.getState().zoomIn();
          accumulated += WHEEL_ZOOM_THRESHOLD;
        }
      }
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, []);
}
