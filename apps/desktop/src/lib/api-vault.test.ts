import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { api } from "@/lib/api";

describe("vault command contracts", () => {
  beforeEach(() => invoke.mockReset());

  it("opens the vault root without requiring a relative path", async () => {
    await api.vaultOpenFolder();

    expect(invoke).toHaveBeenCalledWith("vault_open_folder");
  });
});
