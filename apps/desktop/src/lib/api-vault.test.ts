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

  it("passes batch transfer previews and conflict policies to Tauri", async () => {
    await api.vaultPreviewTransfer("pack/docs", ["/tmp/a.md"], "copy");
    expect(invoke).toHaveBeenLastCalledWith("vault_preview_transfer", {
      destDir: "pack/docs",
      sourcePaths: ["/tmp/a.md"],
      operation: "copy",
    });

    await api.vaultApplyTransfer(
      "pack/docs",
      ["source/a.md", "source/b.md"],
      "move",
      "skip",
    );
    expect(invoke).toHaveBeenLastCalledWith("vault_apply_transfer", {
      destDir: "pack/docs",
      sourcePaths: ["source/a.md", "source/b.md"],
      operation: "move",
      conflictPolicy: "skip",
    });
  });
});
