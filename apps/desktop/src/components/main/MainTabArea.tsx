import { useQuery } from "@tanstack/react-query";
import { BookOpen, Cloud, PackageOpen } from "lucide-react";
import { type CSSProperties, useEffect, useRef } from "react";
import { HubPanel } from "@/components/hub/HubPanel";
import { MainTabBar } from "@/components/main/MainTabBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { MessagesPanel } from "@/components/messages/MessagesPanel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DiffViewer } from "@/components/viewer/DiffViewer";
import { ImageViewer } from "@/components/viewer/ImageViewer";
import { MarkdownEditor } from "@/components/viewer/MarkdownEditor";
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { isImagePath } from "@/lib/vault-paths";
import { useEditorStore } from "@/stores/editor";
import {
  HUB_TAB_ID,
  MESSAGES_TAB_ID,
  parseDiffTabId,
  SETTINGS_TAB_ID,
  useUiStore,
} from "@/stores/ui";

const WHEEL_ZOOM_THRESHOLD = 50;

export function MainTabArea() {
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const openHubTab = useUiStore((s) => s.openHubTab);
  const editingPaths = useEditorStore((s) => s.editingPaths);
  const contentZoom = useUiStore((s) => s.contentZoom);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let accumulated = 0;
    const handleWheel = (e: WheelEvent) => {
      // Trackpad pinch-to-zoom is delivered as a wheel event with
      // ctrlKey: true regardless of whether Ctrl is physically held.
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
    // React's synthetic onWheel is passive at the root and can't
    // preventDefault, so this needs a native listener.
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  const treeQuery = useQuery({
    queryKey: queryKeys.tree,
    queryFn: api.vaultListTree,
  });

  const vaultEmpty =
    !treeQuery.isLoading && (treeQuery.data?.length ?? 0) === 0;

  const diffTab = activeMainTabId ? parseDiffTabId(activeMainTabId) : null;

  let content;
  if (activeMainTabId === HUB_TAB_ID) {
    content = <HubPanel />;
  } else if (activeMainTabId === SETTINGS_TAB_ID) {
    content = <SettingsPanel />;
  } else if (activeMainTabId === MESSAGES_TAB_ID) {
    content = <MessagesPanel />;
  } else if (diffTab) {
    content = (
      <DiffViewer
        key={activeMainTabId}
        packId={diffTab.packId}
        path={diffTab.path}
      />
    );
  } else if (activeMainTabId) {
    content = isImagePath(activeMainTabId) ? (
      <ImageViewer key={activeMainTabId} path={activeMainTabId} />
    ) : editingPaths.has(activeMainTabId) ? (
      <MarkdownEditor key={activeMainTabId} path={activeMainTabId} />
    ) : (
      <MarkdownViewer path={activeMainTabId} />
    );
  } else if (vaultEmpty) {
    content = (
      <EmptyState
        icon={<PackageOpen className="size-8 text-primary" />}
        title="Your library is empty"
        description="Download a knowledge pack from Hub to get started."
      >
        <Button onClick={openHubTab}>
          <Cloud className="size-4" />
          Open Hub
        </Button>
      </EmptyState>
    );
  } else {
    content = (
      <EmptyState
        icon={<BookOpen className="size-8 text-primary" />}
        title="Select a knowledge file"
        description="Browse the library tree. Knowledge files are read-only after download."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MainTabBar />
      <div
        ref={contentRef}
        className="min-h-0 flex-1"
        style={{ "--content-zoom": contentZoom } as CSSProperties}
      >
        {content}
      </div>
    </div>
  );
}
