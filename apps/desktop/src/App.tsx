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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

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
  // Ignore spurious zero sizes while panels are laying out / remounting.
  const syncingLibrary = useRef(false);
  const syncingChat = useRef(false);

  const treeQuery = useQuery({
    queryKey: ["tree"],
    queryFn: api.vaultListTree,
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
    if (libraryVisible) panel.expand();
    else panel.collapse();
    const id = requestAnimationFrame(() => {
      syncingLibrary.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [libraryVisible, libraryPanelRef]);

  useEffect(() => {
    const panel = chatPanelRef.current;
    if (!panel) return;
    syncingChat.current = true;
    if (chatOpen) panel.expand();
    else panel.collapse();
    const id = requestAnimationFrame(() => {
      syncingChat.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [chatOpen, chatPanelRef]);

  function handleToggleSidebar() {
    const next = !sidebarOpen;
    setSidebarOpen(next);
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
            defaultSize={sidebarOpen ? 260 : 0}
            minSize={180}
            maxSize={420}
            className="overflow-hidden bg-sidebar"
            onResize={(size) => {
              // Only persist user-driven resize while the library tab is active.
              if (syncingLibrary.current || activePanel !== "library") return;
              const open = size.inPixels > 0;
              if (open !== sidebarOpen) setSidebarOpen(open);
            }}
          >
            <aside className="flex h-full min-h-0 flex-col border-r border-border">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Library
              </div>
              <ScrollArea className="min-h-0 flex-1">
                {treeQuery.isLoading ? (
                  <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                ) : treeQuery.error ? (
                  <p className="p-4 text-sm text-destructive">
                    {(treeQuery.error as Error).message}
                  </p>
                ) : (
                  <LibraryTree tree={treeQuery.data ?? []} />
                )}
              </ScrollArea>
            </aside>
          </ResizablePanel>

          {libraryVisible ? <ResizableHandle withHandle className="w-1.5" /> : null}

          <ResizablePanel id="main" minSize="30%" defaultSize="50%" className="bg-card/60">
            <main className="h-full min-w-0 overflow-hidden">
              {activePanel === "library" && <MarkdownViewer />}
              {activePanel === "hub" && <HubPanel />}
              {activePanel === "settings" && <SettingsPanel />}
            </main>
          </ResizablePanel>

          {chatOpen ? <ResizableHandle withHandle className="w-1.5" /> : null}

          <ResizablePanel
            id="chat"
            panelRef={chatPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize={chatOpen ? 360 : 0}
            minSize={280}
            maxSize={640}
            className="overflow-hidden bg-panel"
            onResize={(size) => {
              if (syncingChat.current) return;
              const open = size.inPixels > 0;
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
