import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "./editor";
import {
  CONTENT_ZOOM_DEFAULT,
  CONTENT_ZOOM_MAX,
  CONTENT_ZOOM_MIN,
  SETTINGS_TAB_ID,
  useUiStore,
} from "./ui";

describe("settings navigation", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useUiStore.setState({
      openMainTabs: [],
      activeMainTabId: null,
      settingsSection: "general",
      settingsTarget: null,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("opens account links on the Account settings section", () => {
    useUiStore.getState().openAccountSettingsTab();

    expect(useUiStore.getState()).toMatchObject({
      activeMainTabId: SETTINGS_TAB_ID,
      settingsSection: "account",
    });
  });

  it("keeps the main Settings navigation targeted at General", () => {
    useUiStore.getState().openAccountSettingsTab();
    useUiStore.getState().openSettingsTab();

    expect(useUiStore.getState().settingsSection).toBe("general");
  });

  it("opens Hub settings links at the Hub URL field", () => {
    useUiStore.getState().openHubSettingsTab();

    expect(useUiStore.getState()).toMatchObject({
      activeMainTabId: SETTINGS_TAB_ID,
      settingsSection: "general",
      settingsTarget: "hub-url",
    });
  });
});

describe("content zoom", () => {
  beforeEach(() => {
    useUiStore.setState({ contentZoom: CONTENT_ZOOM_DEFAULT });
  });

  it("zooms in and out in steps, clamped to the max/min", () => {
    useUiStore.getState().zoomIn();
    expect(useUiStore.getState().contentZoom).toBeCloseTo(1.1);

    for (let i = 0; i < 20; i++) useUiStore.getState().zoomIn();
    expect(useUiStore.getState().contentZoom).toBe(CONTENT_ZOOM_MAX);

    for (let i = 0; i < 40; i++) useUiStore.getState().zoomOut();
    expect(useUiStore.getState().contentZoom).toBe(CONTENT_ZOOM_MIN);
  });

  it("resets to the default zoom level", () => {
    useUiStore.getState().zoomIn();
    useUiStore.getState().resetContentZoom();

    expect(useUiStore.getState().contentZoom).toBe(CONTENT_ZOOM_DEFAULT);
  });
});

describe("main tab close requests", () => {
  beforeEach(() => {
    useUiStore.setState({
      openMainTabs: ["a.md", "b.md"],
      activeMainTabId: "a.md",
      previewMainTabId: null,
      pendingCloseTabId: null,
    });
    useEditorStore.setState({
      dirtyPaths: new Set(),
      editingPaths: new Set(),
    });
  });

  it("closes a clean tab immediately", () => {
    useUiStore.getState().requestCloseMainTab("a.md");

    expect(useUiStore.getState().openMainTabs).toEqual(["b.md"]);
    expect(useUiStore.getState().pendingCloseTabId).toBeNull();
  });

  it("defers a dirty tab to confirmation instead of closing it", () => {
    useEditorStore.setState({ dirtyPaths: new Set(["a.md"]) });

    useUiStore.getState().requestCloseMainTab("a.md");

    expect(useUiStore.getState().openMainTabs).toEqual(["a.md", "b.md"]);
    expect(useUiStore.getState().pendingCloseTabId).toBe("a.md");
  });

  it("discards and closes the pending tab on confirm, clearing dirty/editing state", () => {
    useEditorStore.setState({
      dirtyPaths: new Set(["a.md"]),
      editingPaths: new Set(["a.md"]),
    });
    useUiStore.getState().requestCloseMainTab("a.md");

    useUiStore.getState().confirmDiscardAndCloseMainTab();

    expect(useUiStore.getState().openMainTabs).toEqual(["b.md"]);
    expect(useUiStore.getState().pendingCloseTabId).toBeNull();
    expect(useEditorStore.getState().dirtyPaths.has("a.md")).toBe(false);
    expect(useEditorStore.getState().editingPaths.has("a.md")).toBe(false);
  });

  it("cancels a pending close without closing the tab", () => {
    useEditorStore.setState({ dirtyPaths: new Set(["a.md"]) });
    useUiStore.getState().requestCloseMainTab("a.md");

    useUiStore.getState().cancelPendingCloseMainTab();

    expect(useUiStore.getState().openMainTabs).toEqual(["a.md", "b.md"]);
    expect(useUiStore.getState().pendingCloseTabId).toBeNull();
  });
});
