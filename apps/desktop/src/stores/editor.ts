import { create } from "zustand";

/**
 * Which open file tabs are currently showing the editor (vs. the read-only
 * viewer) and which have unsaved changes. Deliberately not persisted: a
 * relaunch with unsaved in-memory edits should land back in read view with
 * the last-saved content, not silently reopen a stale editor.
 */
type EditorUiState = {
  editingPaths: Set<string>;
  dirtyPaths: Set<string>;
  agentRunActive: boolean;
  setEditing: (path: string, editing: boolean) => void;
  setDirty: (path: string, dirty: boolean) => void;
  setAgentRunActive: (active: boolean) => void;
};

export const useEditorStore = create<EditorUiState>((set, get) => ({
  editingPaths: new Set(),
  dirtyPaths: new Set(),
  agentRunActive: false,
  setAgentRunActive: (agentRunActive) => set({ agentRunActive }),
  setEditing: (path, editing) => {
    if (editing && get().agentRunActive) return;
    if (get().editingPaths.has(path) === editing) return;
    set((state) => {
      const next = new Set(state.editingPaths);
      if (editing) next.add(path);
      else next.delete(path);
      return { editingPaths: next };
    });
  },
  setDirty: (path, dirty) => {
    // Called on every keystroke while editing — skip the Set copy (and the
    // re-render it triggers in anything subscribed to dirtyPaths, like the
    // tab bar's dirty dot) when the dirty flag isn't actually changing.
    if (get().dirtyPaths.has(path) === dirty) return;
    set((state) => {
      const next = new Set(state.dirtyPaths);
      if (dirty) next.add(path);
      else next.delete(path);
      return { dirtyPaths: next };
    });
  },
}));
