import type { HubUser, InstalledPack } from "@nest/shared";
import { describe, expect, it } from "vitest";
import { canEditPack, canRenamePack } from "./pack-permissions";

function pack(overrides: Partial<InstalledPack> = {}): InstalledPack {
  return {
    pack_id: "sample",
    name: "Sample",
    local_path: "sample",
    version: "1.0.0",
    last_synced: null,
    active: true,
    origin: "registry",
    owner_id: null,
    description: "",
    pending_version: null,
    pending_request_id: null,
    ...overrides,
  };
}

function user(overrides: Partial<HubUser> = {}): HubUser {
  return {
    uuid: "uuid-1",
    id: "alice",
    name: "Alice",
    role: "user",
    managed: false,
    ...overrides,
  };
}

describe("canEditPack", () => {
  it("always allows editing local-origin packs", () => {
    expect(canEditPack(pack({ origin: "local", owner_id: null }), null)).toBe(
      true,
    );
  });

  it("denies editing when signed out", () => {
    expect(
      canEditPack(pack({ origin: "registry", owner_id: "alice" }), null),
    ).toBe(false);
  });

  it("allows the owner (matched by login id, not uuid) to edit", () => {
    expect(
      canEditPack(
        pack({ origin: "registry", owner_id: "alice" }),
        user({ id: "alice", uuid: "uuid-1" }),
      ),
    ).toBe(true);
  });

  it("denies non-owners", () => {
    expect(
      canEditPack(
        pack({ origin: "registry", owner_id: "alice" }),
        user({ id: "bob" }),
      ),
    ).toBe(false);
  });

  it("fails closed when ownership is unknown", () => {
    expect(
      canEditPack(pack({ origin: "registry", owner_id: null }), user()),
    ).toBe(false);
  });

  it("allows admin and superuser accounts to edit any registry pack, not just ones they own", () => {
    expect(
      canEditPack(
        pack({ origin: "registry", owner_id: "alice" }),
        user({ id: "bob", role: "admin" }),
      ),
    ).toBe(true);
    expect(
      canEditPack(
        pack({ origin: "registry", owner_id: null }),
        user({ id: "bob", role: "superuser" }),
      ),
    ).toBe(true);
  });

  it("never allows editing bundled or unknown-origin packs, even for admins", () => {
    for (const origin of ["bundled", "unknown"] as const) {
      expect(canEditPack(pack({ origin, owner_id: null }), null)).toBe(false);
      expect(
        canEditPack(pack({ origin, owner_id: null }), user({ role: "superuser" })),
      ).toBe(false);
    }
  });
});

describe("canRenamePack", () => {
  it("allows renaming local packs", () => {
    expect(canRenamePack(pack({ origin: "local" }))).toBe(true);
  });

  it("never allows renaming a registry pack, even for its owner or an admin", () => {
    // canRenamePack intentionally ignores ownership/role — a downloaded
    // pack's identity belongs to the hub regardless of who can edit its files.
    expect(canRenamePack(pack({ origin: "registry" }))).toBe(false);
  });

  it("never allows renaming bundled or unknown-origin packs", () => {
    expect(canRenamePack(pack({ origin: "bundled" }))).toBe(false);
    expect(canRenamePack(pack({ origin: "unknown" }))).toBe(false);
  });
});
