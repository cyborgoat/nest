import { useQuery } from "@tanstack/react-query";
import type { TreeNode } from "@nest/shared";
import { Bell, Cloud, MessageSquare, Settings2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ActivityBar } from "@/components/library/ActivityBar";
import { LibrarySidebar } from "@/components/library/LibrarySidebar";
import { MainTabArea } from "@/components/main/MainTabArea";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { I18nProvider } from "@/lib/i18n";
import { animatePanelSize, cancelPanelAnimation } from "@/lib/panel-animation";
import { cn } from "@/lib/utils";
import {
  HUB_TAB_ID,
  MESSAGES_TAB_ID,
  SETTINGS_TAB_ID,
  useUiStore,
} from "@/stores/ui";

const LIBRARY_DEFAULT_PX = 220;
const LIBRARY_MIN_PX = 180;
const CHAT_DEFAULT_PX = 300;
const CHAT_MIN_PX = 280;

function collectFilePaths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder"
      ? collectFilePaths(node.children ?? [])
      : [node.path],
  );
}

export default function App() {
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const openHubTab = useUiStore((s) => s.openHubTab);
  const openSettingsTab = useUiStore((s) => s.openSettingsTab);
  const openMessagesTab = useUiStore((s) => s.openMessagesTab);
  const pruneMainFileTabs = useUiStore((s) => s.pruneMainFileTabs);
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
    queryKey: queryKeys.tree,
    queryFn: api.vaultListTree,
  });

  const installedQuery = useQuery({
    queryKey: queryKeys.installedPacks,
    queryFn: api.hubListInstalled,
  });

  const indexQuery = useQuery({
    queryKey: queryKeys.index,
    queryFn: api.indexStatus,
    refetchInterval: (q) => (q.state.data?.is_indexing ? 1000 : 10_000),
  });

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.settingsGet,
  });

  const hubAuthQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const messageCountQuery = useQuery({
    queryKey: queryKeys.messageCount,
    queryFn: api.hubUnreadMessageCount,
    enabled: hubAuthQuery.data?.authenticated === true,
    refetchInterval: 30_000,
  });

  const fontSizePt = settingsQuery.data?.font_size_pt ?? 10;
  const shell = {
    appSubtitle: "Knowledge workspace",
    hub: "Hub",
    settings: "Settings",
    chat: "Chat",
    collapseChat: "Collapse chat",
    expandChat: "Expand chat",
    indexing: " · indexing…",
    ready: "Ready",
    index: "Index",
    files: "files",
    chunks: "chunks",
  };

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-font-size",
      `${fontSizePt}pt`,
    );
    document.documentElement.lang = "en";
    document.documentElement.dataset.locale = "en";
  }, [fontSizePt]);

  useEffect(() => {
    if (!treeQuery.data) return;
    pruneMainFileTabs(new Set(collectFilePaths(treeQuery.data)));
  }, [treeQuery.data, pruneMainFileTabs]);

  const libraryVisible = sidebarOpen;

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

  function handleToggleChat() {
    setChatOpen(!chatOpen);
  }

  return (
    <I18nProvider locale="en">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-border bg-panel/80 px-4 py-2.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/nest-logo-transparent.png"
                alt=""
                className="size-8 object-contain"
                draggable={false}
              />
              <div>
                <h1 className="font-display text-lg leading-none tracking-tight">
                  Nest
                </h1>
                <p className="text-[11px] text-muted-foreground">
                  {shell.appSubtitle}
                </p>
              </div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <NavButton
              active={activeMainTabId === HUB_TAB_ID}
              onClick={openHubTab}
              icon={<Cloud className="size-4" />}
              label={shell.hub}
            />
            <NavButton
              active={activeMainTabId === MESSAGES_TAB_ID}
              onClick={openMessagesTab}
              icon={<Bell className="size-4" />}
              label="Messages"
              dot={(messageCountQuery.data?.count ?? 0) > 0}
            />
            <NavButton
              active={activeMainTabId === SETTINGS_TAB_ID}
              onClick={openSettingsTab}
              icon={<Settings2 className="size-4" />}
              label={shell.settings}
            />
            <Separator orientation="vertical" className="mx-1 h-6" />
            <NavButton
              active={chatOpen}
              onClick={handleToggleChat}
              icon={<MessageSquare className="size-4" />}
              label={shell.chat}
              title={chatOpen ? shell.collapseChat : shell.expandChat}
            />
          </nav>
        </header>

        <div className="flex min-h-0 flex-1">
          <ActivityBar />
          <ResizablePanelGroup orientation="horizontal" className="h-full flex-1">
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
                if (syncingLibrary.current) return;
                if (size.inPixels >= LIBRARY_MIN_PX) {
                  libraryLastSizeRef.current = size.inPixels;
                }
                const open = size.inPixels > 8;
                if (open !== sidebarOpen) setSidebarOpen(open);
              }}
            >
              <LibrarySidebar
                tree={treeQuery.data ?? []}
                installed={installedQuery.data ?? []}
                loading={treeQuery.isLoading}
                error={treeQuery.error as Error | null}
              />
            </ResizablePanel>

            {/* Keep handle mounted so layout does not snap when collapsing. */}
            <ResizableHandle
              withHandle={libraryVisible}
              disabled={!libraryVisible}
              className={cn(
                "transition-[width,opacity] duration-200 ease-out",
                libraryVisible
                  ? "w-px opacity-100"
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
                <MainTabArea />
              </main>
            </ResizablePanel>

            <ResizableHandle
              withHandle={chatOpen}
              disabled={!chatOpen}
              className={cn(
                "transition-[width,opacity] duration-200 ease-out",
                chatOpen
                  ? "w-px opacity-100"
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
            {shell.index}: {indexQuery.data?.indexed_files ?? 0} {shell.files} /{" "}
            {indexQuery.data?.indexed_chunks ?? 0} {shell.chunks}
            {indexQuery.data?.is_indexing ? shell.indexing : ""}
          </span>
          <span className="truncate pl-4">{statusMessage ?? shell.ready}</span>
        </footer>

        <Toaster position="bottom-right" closeButton />
      </div>
    </I18nProvider>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  title,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title?: string;
  dot?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
      title={title}
    >
      <span className="relative inline-flex">
        {icon}
        {dot ? (
          <span className="absolute -right-1 -top-1 block size-2.5 rounded-full bg-destructive ring-2 ring-background" />
        ) : null}
      </span>
      {label}
    </Button>
  );
}
