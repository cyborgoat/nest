import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useEditorStore } from "./editor";

export const HUB_TAB_ID = "__hub__";
export const SETTINGS_TAB_ID = "__settings__";
export const MESSAGES_TAB_ID = "__messages__";
export type SettingsSection = "general" | "account";
export type SettingsTarget = "hub-url";
export type ActivitySidebarView = "explorer" | "source-control" | "reviews";

/** Whole-app webview zoom. Session-only: deliberately excluded from
 * `partialize` below so every launch starts at 100%. */
export const APP_ZOOM_MIN = 0.5;
export const APP_ZOOM_MAX = 2;
export const APP_ZOOM_DEFAULT = 1;
const APP_ZOOM_STEP = 0.1;

function clampAppZoom(value: number): number {
  return Math.min(
    APP_ZOOM_MAX,
    Math.max(APP_ZOOM_MIN, Math.round(value * 100) / 100),
  );
}

const DIFF_TAB_PREFIX = "diff:";

export function diffTabId(packId: string, path: string): string {
  return `${DIFF_TAB_PREFIX}${packId}:${path}`;
}

export function parseDiffTabId(
  id: string,
): { packId: string; path: string } | null {
  if (!id.startsWith(DIFF_TAB_PREFIX)) return null;
  const rest = id.slice(DIFF_TAB_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx < 0) return null;
  return { packId: rest.slice(0, idx), path: rest.slice(idx + 1) };
}

type UiState = {
  sidebarOpen: boolean;
  chatOpen: boolean;
  activitySidebarView: ActivitySidebarView;
  setActivitySidebarView: (view: ActivitySidebarView) => void;
  statusMessage: string | null;
  /** Active chat session id */
  chatSessionId: string | null;
  /** Browser-style open tabs (session ids) */
  openChatTabs: string[];
  /** Browser-style open main-content tabs (file paths, or HUB_TAB_ID/SETTINGS_TAB_ID) */
  openMainTabs: string[];
  activeMainTabId: string | null;
  settingsSection: SettingsSection;
  settingsTarget: SettingsTarget | null;
  hubSection: "browse" | "installed";
  requestedPublishMessageId: string | null;
  /** VS Code-style "preview" tab: at most one, replaced (not appended) by the
   * next single-clicked file until it's promoted to a permanent tab. */
  previewMainTabId: string | null;
  /** Whole-app zoom level (1 = 100%), session-only. */
  appZoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetAppZoom: () => void;
  /** Tab awaiting discard-confirmation before it can close, session-only. */
  pendingCloseTabId: string | null;
  requestCloseMainTab: (id: string) => void;
  confirmDiscardAndCloseMainTab: () => void;
  cancelPendingCloseMainTab: () => void;
  setActiveMainTab: (id: string) => void;
  clearPathsUnder: (path: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setStatusMessage: (message: string | null) => void;
  openChatTab: (id: string) => void;
  closeChatTab: (id: string) => void;
  pruneChatTabs: (validIds: Set<string>) => void;
  openFileTab: (path: string, opts?: { preview?: boolean }) => void;
  openDiffTab: (packId: string, path: string) => void;
  openHubTab: () => void;
  openHubInstalledTab: () => void;
  openSettingsTab: () => void;
  openHubSettingsTab: () => void;
  openAccountSettingsTab: () => void;
  clearSettingsTarget: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  openMessagesTab: () => void;
  openPublishMessage: (requestId: string) => void;
  clearRequestedPublishMessage: () => void;
  closeMainTab: (id: string) => void;
  pruneMainFileTabs: (validPaths: Set<string>) => void;
};

function pathMatchesOrUnder(candidate: string, removed: string) {
  return candidate === removed || candidate.startsWith(`${removed}/`);
}

/** Like `pathMatchesOrUnder`, but resolves a diff-tab id to the file path it
 * diffs first, so removing/deactivating a path also closes its diff tab. */
function tabMatchesRemovedPath(id: string, removed: string) {
  const parsed = parseDiffTabId(id);
  return pathMatchesOrUnder(parsed ? parsed.path : id, removed);
}

/** Neighbor-fallback: if `activeId` survived into `nextTabs`, keep it; otherwise
 * fall back to whatever now sits at its old index (clamped), mirroring closeChatTab. */
function nextActiveAfterRemoval(
  oldTabs: string[],
  nextTabs: string[],
  activeId: string | null,
) {
  if (activeId === null) return null;
  if (nextTabs.includes(activeId)) return activeId;
  const idx = oldTabs.indexOf(activeId);
  return (
    nextTabs[Math.min(Math.max(idx, 0), Math.max(0, nextTabs.length - 1))] ??
    null
  );
}

/** Insert `path` in place of the current preview tab (if any), otherwise append. */
function replacePreviewOrAppend(
  tabs: string[],
  previewId: string | null,
  path: string,
) {
  const idx = previewId ? tabs.indexOf(previewId) : -1;
  if (idx < 0) return [...tabs, path];
  const next = [...tabs];
  next.splice(idx, 1, path);
  return next;
}

/** Drop the preview flag if the tab it points at is no longer open. */
function prunedPreview(previewId: string | null, nextTabs: string[]) {
  return previewId && nextTabs.includes(previewId) ? previewId : null;
}

const EPHEMERAL_TAB_IDS = new Set([
  HUB_TAB_ID,
  SETTINGS_TAB_ID,
  MESSAGES_TAB_ID,
]);

/** Hub/Settings tabs are ephemeral: they only exist while active, and close
 * themselves the moment focus moves to a different tab. */
function closeEphemeralExcept(tabs: string[], keepId: string) {
  return tabs.filter((id) => !EPHEMERAL_TAB_IDS.has(id) || id === keepId);
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => {
      /** Shared body for the ephemeral (Hub/Settings/Messages) tab-open
       * actions below: promote/append `tabId` and make it active, merging
       * any tab-specific extra fields (e.g. which settings section). */
      const openEphemeralTab = (tabId: string, patch?: Partial<UiState>) => {
        const { openMainTabs } = get();
        const cleaned = closeEphemeralExcept(openMainTabs, tabId);
        set({
          openMainTabs: cleaned.includes(tabId) ? cleaned : [...cleaned, tabId],
          activeMainTabId: tabId,
          ...patch,
        });
      };

      return {
        sidebarOpen: true,
        chatOpen: true,
        activitySidebarView: "explorer",
        setActivitySidebarView: (view) => set({ activitySidebarView: view }),
        statusMessage: null,
        chatSessionId: null,
        openChatTabs: [],
        openMainTabs: [],
        activeMainTabId: null,
        settingsSection: "general",
        settingsTarget: null,
        hubSection: "browse",
        requestedPublishMessageId: null,
        previewMainTabId: null,
        appZoom: APP_ZOOM_DEFAULT,
        zoomIn: () =>
          set((s) => ({
            appZoom: clampAppZoom(s.appZoom + APP_ZOOM_STEP),
          })),
        zoomOut: () =>
          set((s) => ({
            appZoom: clampAppZoom(s.appZoom - APP_ZOOM_STEP),
          })),
        resetAppZoom: () => set({ appZoom: APP_ZOOM_DEFAULT }),
        pendingCloseTabId: null,
        requestCloseMainTab: (id) => {
          if (useEditorStore.getState().dirtyPaths.has(id)) {
            set({ pendingCloseTabId: id });
          } else {
            get().closeMainTab(id);
          }
        },
        confirmDiscardAndCloseMainTab: () => {
          const { pendingCloseTabId } = get();
          if (pendingCloseTabId) {
            useEditorStore.getState().setDirty(pendingCloseTabId, false);
            useEditorStore.getState().setEditing(pendingCloseTabId, false);
            get().closeMainTab(pendingCloseTabId);
          }
          set({ pendingCloseTabId: null });
        },
        cancelPendingCloseMainTab: () => set({ pendingCloseTabId: null }),
        setActiveMainTab: (id) => {
          const { openMainTabs } = get();
          set({
            openMainTabs: closeEphemeralExcept(openMainTabs, id),
            activeMainTabId: id,
          });
        },
        clearPathsUnder: (path) => {
          const { openMainTabs, activeMainTabId, previewMainTabId } = get();
          const nextTabs = openMainTabs.filter(
            (id) => !tabMatchesRemovedPath(id, path),
          );
          set({
            openMainTabs: nextTabs,
            activeMainTabId: nextActiveAfterRemoval(
              openMainTabs,
              nextTabs,
              activeMainTabId,
            ),
            previewMainTabId: prunedPreview(previewMainTabId, nextTabs),
          });
        },
        setSidebarOpen: (open) => set({ sidebarOpen: open }),
        setChatOpen: (open) => set({ chatOpen: open }),
        setStatusMessage: (message) => set({ statusMessage: message }),
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
              nextTabs[Math.min(idx, Math.max(0, nextTabs.length - 1))] ??
              null;
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
        openFileTab: (path, opts) => {
          const asPreview = opts?.preview ?? true;
          const { openMainTabs, previewMainTabId } = get();
          const cleaned = closeEphemeralExcept(openMainTabs, path);
          if (cleaned.includes(path)) {
            set({
              openMainTabs: cleaned,
              activeMainTabId: path,
              // Opening an already-open tab again promotes it out of preview.
              previewMainTabId:
                previewMainTabId === path ? null : previewMainTabId,
            });
            return;
          }
          set({
            openMainTabs: replacePreviewOrAppend(
              cleaned,
              previewMainTabId,
              path,
            ),
            activeMainTabId: path,
            previewMainTabId: asPreview ? path : null,
          });
        },
        openDiffTab: (packId, path) => {
          const id = diffTabId(packId, path);
          const { openMainTabs, previewMainTabId } = get();
          const cleaned = closeEphemeralExcept(openMainTabs, id);
          if (cleaned.includes(id)) {
            set({
              openMainTabs: cleaned,
              activeMainTabId: id,
              previewMainTabId:
                previewMainTabId === id ? null : previewMainTabId,
            });
            return;
          }
          set({
            // Diff tabs always open as preview — clicking through several
            // changed files in Source Control shouldn't spam permanent tabs.
            openMainTabs: replacePreviewOrAppend(cleaned, previewMainTabId, id),
            activeMainTabId: id,
            previewMainTabId: id,
          });
        },
        openHubTab: () => openEphemeralTab(HUB_TAB_ID, { hubSection: "browse" }),
        openHubInstalledTab: () =>
          openEphemeralTab(HUB_TAB_ID, { hubSection: "installed" }),
        openSettingsTab: () =>
          openEphemeralTab(SETTINGS_TAB_ID, {
            settingsSection: "general",
            settingsTarget: null,
          }),
        openHubSettingsTab: () =>
          openEphemeralTab(SETTINGS_TAB_ID, {
            settingsSection: "general",
            settingsTarget: "hub-url",
          }),
        openAccountSettingsTab: () =>
          openEphemeralTab(SETTINGS_TAB_ID, {
            settingsSection: "account",
            settingsTarget: null,
          }),
        clearSettingsTarget: () => set({ settingsTarget: null }),
        setSettingsSection: (settingsSection) => set({ settingsSection }),
        openMessagesTab: () => openEphemeralTab(MESSAGES_TAB_ID),
        openPublishMessage: (requestId) =>
          openEphemeralTab(MESSAGES_TAB_ID, {
            requestedPublishMessageId: requestId,
          }),
        clearRequestedPublishMessage: () =>
          set({ requestedPublishMessageId: null }),
        closeMainTab: (id) => {
          const { openMainTabs, activeMainTabId, previewMainTabId } = get();
          const nextTabs = openMainTabs.filter((t) => t !== id);
          set({
            openMainTabs: nextTabs,
            activeMainTabId: nextActiveAfterRemoval(
              openMainTabs,
              nextTabs,
              activeMainTabId,
            ),
            previewMainTabId: prunedPreview(previewMainTabId, nextTabs),
          });
        },
        pruneMainFileTabs: (validPaths) => {
          const { openMainTabs, activeMainTabId, previewMainTabId } = get();
          const nextTabs = openMainTabs.filter(
            (id) =>
              id === HUB_TAB_ID ||
              id === SETTINGS_TAB_ID ||
              id === MESSAGES_TAB_ID ||
              // Diff tabs can legitimately point at paths absent from the
              // tree (deleted files) — their lifecycle is managed by
              // discard/close, not this path-existence check.
              parseDiffTabId(id) != null ||
              validPaths.has(id),
          );
          set({
            openMainTabs: nextTabs,
            activeMainTabId: nextActiveAfterRemoval(
              openMainTabs,
              nextTabs,
              activeMainTabId,
            ),
            previewMainTabId: prunedPreview(previewMainTabId, nextTabs),
          });
        },
      };
    },
    {
      name: "nest-ui-chat-tabs",
      partialize: (state) => {
        // Hub/Settings are ephemeral tabs — never restored on relaunch.
        const openMainTabs = state.openMainTabs.filter(
          (id) => !EPHEMERAL_TAB_IDS.has(id),
        );
        const activeMainTabId =
          state.activeMainTabId && openMainTabs.includes(state.activeMainTabId)
            ? state.activeMainTabId
            : (openMainTabs[0] ?? null);
        return {
          chatSessionId: state.chatSessionId,
          openChatTabs: state.openChatTabs,
          openMainTabs,
          activeMainTabId,
          previewMainTabId: state.previewMainTabId,
          activitySidebarView: state.activitySidebarView,
        };
      },
    },
  ),
);
