import type { HubUser, InstalledPack, TreeNode } from "@nest/shared";
import { describe, expect, it } from "vitest";
import {
  collectEditableVaultDestinations,
  defaultVaultDestination,
} from "@/lib/vault-destinations";

const user: HubUser = {
  uuid: "user-uuid",
  id: "alice",
  name: "Alice",
  role: "user",
  managed: false,
};

function pack(overrides: Partial<InstalledPack>): InstalledPack {
  return {
    pack_id: "handbook",
    name: "Handbook",
    local_path: "handbook",
    version: "1.0.0",
    patch_revision: 0,
    last_synced: null,
    active: true,
    origin: "local",
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

const tree: TreeNode[] = [
  {
    name: "handbook",
    path: "handbook",
    kind: "folder",
    children: [
      {
        name: "guides",
        path: "handbook/guides",
        kind: "folder",
        children: [
          {
            name: "advanced",
            path: "handbook/guides/advanced",
            kind: "folder",
          },
        ],
      },
    ],
  },
  { name: "locked", path: "locked", kind: "folder" },
  { name: "read-only", path: "read-only", kind: "folder" },
];

describe("vault destinations", () => {
  it("collects nested folders from editable packs only", () => {
    const destinations = collectEditableVaultDestinations(
      tree,
      [
        pack({}),
        pack({
          pack_id: "locked",
          local_path: "locked",
          name: "Locked",
          publish_review_status: "pending",
        }),
        pack({
          pack_id: "read-only",
          local_path: "read-only",
          name: "Read Only",
          origin: "registry",
          owner_id: "someone-else",
        }),
      ],
      user,
    );

    expect(destinations).toEqual([
      { path: "handbook", label: "Handbook", packId: "handbook" },
      {
        path: "handbook/guides",
        label: "Handbook / guides",
        packId: "handbook",
      },
      {
        path: "handbook/guides/advanced",
        label: "Handbook / guides/advanced",
        packId: "handbook",
      },
    ]);
  });

  it("prefers an available parent and otherwise falls back to the first root", () => {
    const destinations = collectEditableVaultDestinations(
      tree,
      [pack({})],
      user,
    );

    expect(defaultVaultDestination(destinations, "handbook/guides")).toBe(
      "handbook/guides",
    );
    expect(defaultVaultDestination(destinations, "missing")).toBe("handbook");
    expect(defaultVaultDestination([])).toBe("");
  });
});
