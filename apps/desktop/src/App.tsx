import { useQuery } from "@tanstack/react-query";
import {
  BookMarked,
  Cloud,
  MessageSquare,
  PanelLeft,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { HubPanel } from "@/components/hub/HubPanel";
import { LibraryTree } from "@/components/library/LibraryTree";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import {
  animatePanelSize,
  cancelPanelAnimation,
} from "@/lib/panel-animation";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

const LIBRARY_DEFAULT_PX = 260;
const LIBRARY_MIN_PX = 180;
const CHAT_DEFAULT_PX = 360;
const CHAT_MIN_PX = 280;

export default function App() {
  const activePanel = useUiStore((s) => s.activePanel);
  const setActivePanel = useUiStore((s) => s.setActivePanel);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const chatOpen = useUiStore((s) => s.chatOpen);
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const statusMessage = useUiStore((s) => s.statusMessage);

  const libraryPanelRef = usePanelRef();
  const chatPanelRef = usePanelRef();
  // Ignore onResize while we drive sizes programmatically.
  const syncingLibrary = useRef(false);
  const syncingChat = useRef(false);
  const libraryAnimRef = useRef<number | null>(null);
  const chatAnimRef = useRef<number | null>(null);
  const libraryLastSizeRef = useRef(LIBRARY_DEFAULT_PX);
  const chatLastSizeRef = useRef(CHAT_DEFAULT_PX);
  const libraryReadyRef = useRef(false);
  const chatReadyRef = useRef(false);

  const treeQuery = useQuery({
    queryKey: ["tree"],
    queryFn: api.vaultListTree,
  });

  const installedQuery = useQuery({
    queryKey: ["installed-packs"],
    queryFn: api.hubListInstalled,
  });

  const indexQuery = useQuery({
    queryKey: ["index-status"],
    queryFn: api.indexStatus,
    refetchInterval: (q) => (q.state.data?.is_indexing ? 1000 : 10_000),
  });

  const libraryVisible = activePanel === "library" && sidebarOpen;

  useEffect(() => {
    const panel = libraryPanelRef.current;
    if (!panel) return;

    syncingLibrary.current = true;

    // First sync: no animation (avoid opening animation on load).
    if (!libraryReadyRef.current) {
      libraryReadyRef.current = true;
      panel.resize(libraryVisible ? LIBRARY_DEFAULT_PX : 0);
      const id = requestAnimationFrame(() => {
        syncingLibrary.current = false;
      });
      return () => cancelAnimationFrame(id);
    }

    let cancelled = false;
    const run = async () => {
      if (libraryVisible) {
        const target = Math.max(libraryLastSizeRef.current, LIBRARY_MIN_PX);
        await animatePanelSize(panel, target, libraryAnimRef);
      } else {
        const size = panel.getSize().inPixels;
        if (size > LIBRARY_MIN_PX / 2) libraryLastSizeRef.current = size;
        await animatePanelSize(panel, 0, libraryAnimRef);
      }
      if (!cancelled) syncingLibrary.current = false;
    };
    void run();

    return () => {
      cancelled = true;
      cancelPanelAnimation(libraryAnimRef);
    };
  }, [libraryVisible, libraryPanelRef]);

  useEffect(() => {
    const panel = chatPanelRef.current;
    if (!panel) return;

    syncingChat.current = true;

    if (!chatReadyRef.current) {
      chatReadyRef.current = true;
      panel.resize(chatOpen ? CHAT_DEFAULT_PX : 0);
      const id = requestAnimationFrame(() => {
        syncingChat.current = false;
      });
      return () => cancelAnimationFrame(id);
    }

    let cancelled = false;
    const run = async () => {
      if (chatOpen) {
        const target = Math.max(chatLastSizeRef.current, CHAT_MIN_PX);
        await animatePanelSize(panel, target, chatAnimRef);
      } else {
        const size = panel.getSize().inPixels;
        if (size > CHAT_MIN_PX / 2) chatLastSizeRef.current = size;
        await animatePanelSize(panel, 0, chatAnimRef);
      }
      if (!cancelled) syncingChat.current = false;
    };
    void run();

    return () => {
      cancelled = true;
      cancelPanelAnimation(chatAnimRef);
    };
  }, [chatOpen, chatPanelRef]);

  function handleToggleSidebar() {
    setSidebarOpen(!sidebarOpen);
  }

  function handleToggleChat() {
    setChatOpen(!chatOpen);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-panel/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          {activePanel === "library" && (
            <Button
              size="icon"
              variant={sidebarOpen ? "secondary" : "ghost"}
              className="size-8"
              onClick={handleToggleSidebar}
              title={sidebarOpen ? "Collapse library" : "Expand library"}
              aria-label={sidebarOpen ? "Collapse library" : "Expand library"}
            >
              <PanelLeft className="size-4" />
            </Button>
          )}
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BookMarked className="size-4" />
            </div>
            <div>
              <h1 className="font-display text-lg leading-none tracking-tight">Nest</h1>
              <p className="text-[11px] text-muted-foreground">Knowledge workspace</p>
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-1">
          <NavButton
            active={activePanel === "library"}
            onClick={() => setActivePanel("library")}
            icon={<BookMarked className="size-4" />}
            label="Library"
          />
          <NavButton
            active={activePanel === "hub"}
            onClick={() => setActivePanel("hub")}
            icon={<Cloud className="size-4" />}
            label="Hub"
          />
          <NavButton
            active={activePanel === "settings"}
            onClick={() => setActivePanel("settings")}
            icon={<Settings2 className="size-4" />}
            label="Settings"
          />
          <Separator orientation="vertical" className="mx-1 h-6" />
          <Button
            size="sm"
            variant={chatOpen ? "secondary" : "ghost"}
            onClick={handleToggleChat}
            title={chatOpen ? "Collapse chat" : "Expand chat"}
          >
            <MessageSquare className="size-4" />
            Chat
          </Button>
        </nav>
      </header>

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full">
          <ResizablePanel
            id="library"
            panelRef={libraryPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize={sidebarOpen ? LIBRARY_DEFAULT_PX : 0}
            // minSize must stay 0 so collapse can animate through every pixel;
            // react-resizable-panels snaps anything between collapsedSize and minSize.
            minSize={0}
            maxSize={420}
            className="overflow-hidden bg-sidebar"
            onResize={(size) => {
              // Only persist user-driven resize while the library tab is active.
              if (syncingLibrary.current || activePanel !== "library") return;
              if (size.inPixels >= LIBRARY_MIN_PX) {
                libraryLastSizeRef.current = size.inPixels;
              }
              const open = size.inPixels > 8;
              if (open !== sidebarOpen) setSidebarOpen(open);
            }}
          >
            <aside className="flex h-full min-h-0 flex-col border-r border-border">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Library
              </div>
              <div className="min-h-0 flex-1">
                {treeQuery.isLoading ? (
                  <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                ) : treeQuery.error ? (
                  <p className="p-4 text-sm text-destructive">
                    {(treeQuery.error as Error).message}
                  </p>
                ) : (
                  <LibraryTree
                    tree={treeQuery.data ?? []}
                    installed={installedQuery.data ?? []}
                  />
                )}
              </div>
            </aside>
          </ResizablePanel>

          {/* Keep handle mounted so layout does not snap when collapsing. */}
          <ResizableHandle
            withHandle={libraryVisible}
            disabled={!libraryVisible}
            className={cn(
              "transition-[width,opacity] duration-200 ease-out",
              libraryVisible
                ? "w-1.5 opacity-100"
                : "w-0 opacity-0 pointer-events-none",
            )}
          />

          <ResizablePanel
            id="main"
            minSize="30%"
            defaultSize="50%"
            className="bg-card/60"
          >
            <main className="h-full min-w-0 overflow-hidden">
              {activePanel === "library" && <MarkdownViewer />}
              {activePanel === "hub" && <HubPanel />}
              {activePanel === "settings" && <SettingsPanel />}
            </main>
          </ResizablePanel>

          <ResizableHandle
            withHandle={chatOpen}
            disabled={!chatOpen}
            className={cn(
              "transition-[width,opacity] duration-200 ease-out",
              chatOpen
                ? "w-1.5 opacity-100"
                : "w-0 opacity-0 pointer-events-none",
            )}
          />

          <ResizablePanel
            id="chat"
            panelRef={chatPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize={chatOpen ? CHAT_DEFAULT_PX : 0}
            minSize={0}
            maxSize={640}
            className="overflow-hidden bg-panel"
            onResize={(size) => {
              if (syncingChat.current) return;
              if (size.inPixels >= CHAT_MIN_PX) {
                chatLastSizeRef.current = size.inPixels;
              }
              const open = size.inPixels > 8;
              if (open !== chatOpen) setChatOpen(open);
            }}
          >
            <aside className="flex h-full flex-col border-l border-border">
              <ChatPanel />
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <footer className="flex items-center justify-between border-t border-border bg-panel/90 px-4 py-1.5 text-[11px] text-muted-foreground">
        <span>
          Index: {indexQuery.data?.indexed_files ?? 0} files /{" "}
          {indexQuery.data?.indexed_chunks ?? 0} chunks
          {indexQuery.data?.is_indexing ? " · indexing…" : ""}
        </span>
        <span className="truncate pl-4">{statusMessage ?? "Ready"}</span>
      </footer>

      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
      className={cn(active && "bg-muted")}
    >
      {icon}
      {label}
    </Button>
  );
}
