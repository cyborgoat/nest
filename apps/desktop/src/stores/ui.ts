import { create } from "zustand";

type Panel = "library" | "hub" | "settings";

type UiState = {
  activePanel: Panel;
  selectedPath: string | null;
  selectedScope: string[];
  sidebarOpen: boolean;
  chatOpen: boolean;
  statusMessage: string | null;
  setActivePanel: (panel: Panel) => void;
  setSelectedPath: (path: string | null) => void;
  toggleScope: (path: string) => void;
  clearScope: () => void;
  clearPathsUnder: (path: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setStatusMessage: (message: string | null) => void;
};

function pathMatchesOrUnder(candidate: string, removed: string) {
  return candidate === removed || candidate.startsWith(`${removed}/`);
}

export const useUiStore = create<UiState>((set, get) => ({
  activePanel: "library",
  selectedPath: null,
  selectedScope: [],
  sidebarOpen: true,
  chatOpen: true,
  statusMessage: null,
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
      selectedScope: selectedScope.filter((p) => !pathMatchesOrUnder(p, path)),
    });
  },
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setChatOpen: (open) => set({ chatOpen: open }),
  setStatusMessage: (message) => set({ statusMessage: message }),
}));
