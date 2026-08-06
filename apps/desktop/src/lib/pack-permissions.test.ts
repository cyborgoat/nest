import type { HubUser, InstalledPack } from "@nest/shared";
import { describe, expect, it } from "vitest";
import {
  canEditPack,
  canRenamePack,
  packEditBlockReason,
  shouldTrackPackChanges,
} from "./pack-permissions";

function pack(overrides: Partial<InstalledPack> = {}): InstalledPack {
  return {
    pack_id: "sample",
    name: "Sample",
    local_path: "sample",
    version: "1.0.0",
    patch_revision: 0,
    last_synced: null,
    active: true,
    origin: "registry",
    owner_id: null,
    description: "",
    pending_version: null,
    pending_request_type: null,
    pending_patch_revision: null,
    pending_request_id: null,
    publish_review_status: null,
    publish_review_created_at: null,
    pending_can_cancel: false,
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

  it("locks pending packs regardless of origin or role", () => {
    expect(
      canEditPack(
        pack({ origin: "local", publish_review_status: "pending" }),
        user({ role: "superuser" }),
      ),
    ).toBe(false);
  });

  it("allows editing after approval while merge is pending", () => {
    expect(
      canEditPack(
        pack({
          origin: "registry",
          owner_id: "alice",
          publish_review_status: "approved_awaiting_merge",
        }),
        user(),
      ),
    ).toBe(true);
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
        canEditPack(
          pack({ origin, owner_id: null }),
          user({ role: "superuser" }),
        ),
      ).toBe(false);
    }
  });
});

describe("packEditBlockReason", () => {
  it("identifies another maintainer whose publish request locked the pack", () => {
    expect(
      packEditBlockReason(
        pack({
          publish_review_status: "pending",
          pending_submitter_id: "bob",
          pending_submitter_name: "Bob",
        }),
        user(),
      ),
    ).toBe("Bob (@bob) has a pending publish request.");
  });

  it("identifies the signed-in user's own pending request", () => {
    expect(
      packEditBlockReason(
        pack({
          publish_review_status: "pending",
          pending_submitter_id: "alice",
          pending_submitter_name: "Alice",
        }),
        user(),
      ),
    ).toBe("Your publish request is under review.");
  });
});

describe("canRenamePack", () => {
  it("allows renaming local packs", () => {
    expect(canRenamePack(pack({ origin: "local" }))).toBe(true);
  });

  it("does not allow renaming a local pack under review", () => {
    expect(
      canRenamePack(
        pack({ origin: "local", publish_review_status: "pending" }),
      ),
    ).toBe(false);
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

describe("shouldTrackPackChanges", () => {
  it("tracks editable registry packs", () => {
    expect(
      shouldTrackPackChanges(
        pack({ origin: "registry", owner_id: "alice" }),
        user(),
      ),
    ).toBe(true);
  });

  it("does not track ordinary local packs", () => {
    expect(shouldTrackPackChanges(pack({ origin: "local" }), null)).toBe(
      false,
    );
  });

  it("tracks local packs only while their publish is pending", () => {
    expect(
      shouldTrackPackChanges(
        pack({ origin: "local", publish_review_status: "pending" }),
        null,
      ),
    ).toBe(true);
    expect(
      shouldTrackPackChanges(
        pack({
          origin: "local",
          publish_review_status: "approved_awaiting_merge",
        }),
        null,
      ),
    ).toBe(false);
  });
});
