import { create } from "zustand";
import { persist } from "zustand/middleware";

type Panel = "library" | "hub" | "settings";

type UiState = {
  activePanel: Panel;
  selectedPath: string | null;
  selectedScope: string[];
  sidebarOpen: boolean;
  chatOpen: boolean;
  statusMessage: string | null;
  /** Active chat session id */
  chatSessionId: string | null;
  /** Browser-style open tabs (session ids) */
  openChatTabs: string[];
  setActivePanel: (panel: Panel) => void;
  setSelectedPath: (path: string | null) => void;
  toggleScope: (path: string) => void;
  clearScope: () => void;
  clearPathsUnder: (path: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setStatusMessage: (message: string | null) => void;
  setChatSessionId: (id: string | null) => void;
  openChatTab: (id: string) => void;
  closeChatTab: (id: string) => void;
  pruneChatTabs: (validIds: Set<string>) => void;
};

function pathMatchesOrUnder(candidate: string, removed: string) {
  return candidate === removed || candidate.startsWith(`${removed}/`);
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      activePanel: "library",
      selectedPath: null,
      selectedScope: [],
      sidebarOpen: true,
      chatOpen: true,
      statusMessage: null,
      chatSessionId: null,
      openChatTabs: [],
      setActivePanel: (panel) => set({ activePanel: panel }),
      setSelectedPath: (path) => set({ selectedPath: path }),
      toggleScope: (path) => {
        const current = get().selectedScope;
        set({
          selectedScope: current.includes(path)
            ? current.filter((p) => p !== path)
            : [...current, path],
        });
      },
      clearScope: () => set({ selectedScope: [] }),
      clearPathsUnder: (path) => {
        const { selectedPath, selectedScope } = get();
        set({
          selectedPath:
            selectedPath && pathMatchesOrUnder(selectedPath, path)
              ? null
              : selectedPath,
          selectedScope: selectedScope.filter(
            (p) => !pathMatchesOrUnder(p, path),
          ),
        });
      },
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setChatOpen: (open) => set({ chatOpen: open }),
      setStatusMessage: (message) => set({ statusMessage: message }),
      setChatSessionId: (id) => set({ chatSessionId: id }),
      openChatTab: (id) => {
        const { openChatTabs } = get();
        set({
          openChatTabs: openChatTabs.includes(id)
            ? openChatTabs
            : [...openChatTabs, id],
          chatSessionId: id,
        });
      },
      closeChatTab: (id) => {
        const { openChatTabs, chatSessionId } = get();
        const nextTabs = openChatTabs.filter((t) => t !== id);
        let nextActive = chatSessionId;
        if (chatSessionId === id) {
          const idx = openChatTabs.indexOf(id);
          nextActive =
            nextTabs[Math.min(idx, Math.max(0, nextTabs.length - 1))] ?? null;
        }
        set({ openChatTabs: nextTabs, chatSessionId: nextActive });
      },
      pruneChatTabs: (validIds) => {
        const { openChatTabs, chatSessionId } = get();
        const nextTabs = openChatTabs.filter((id) => validIds.has(id));
        const nextActive =
          chatSessionId && validIds.has(chatSessionId)
            ? chatSessionId
            : (nextTabs[0] ?? null);
        set({ openChatTabs: nextTabs, chatSessionId: nextActive });
      },
    }),
    {
      name: "nest-ui-chat-tabs",
      partialize: (state) => ({
        chatSessionId: state.chatSessionId,
        openChatTabs: state.openChatTabs,
      }),
    },
  ),
);
