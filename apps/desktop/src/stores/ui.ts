import { create } from "zustand";
import { persist } from "zustand/middleware";

type Panel = "library" | "hub" | "settings";

type UiState = {
  activePanel: Panel;
  selectedPath: string | null;
  sidebarOpen: boolean;
  chatOpen: boolean;
  statusMessage: string | null;
  /** Active chat session id */
  chatSessionId: string | null;
  /** Browser-style open tabs (session ids) */
  openChatTabs: string[];
  setActivePanel: (panel: Panel) => void;
  setSelectedPath: (path: string | null) => void;
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
      sidebarOpen: true,
      chatOpen: true,
      statusMessage: null,
      chatSessionId: null,
      openChatTabs: [],
      setActivePanel: (panel) => set({ activePanel: panel }),
      setSelectedPath: (path) => set({ selectedPath: path }),
      clearPathsUnder: (path) => {
        const { selectedPath } = get();
        set({
          selectedPath:
            selectedPath && pathMatchesOrUnder(selectedPath, path)
              ? null
              : selectedPath,
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
