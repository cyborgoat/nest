import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_TAB_ID, useUiStore } from "./ui";

describe("settings navigation", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    useUiStore.setState({
      openMainTabs: [],
      activeMainTabId: null,
      settingsSection: "general",
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
});
