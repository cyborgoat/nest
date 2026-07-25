import type { HubUser, InstalledPack } from "@nest/shared";

/**
 * Whether the current hub user may edit an installed pack's files.
 *
 * `origin === "local"` packs were never downloaded from the hub, so they're
 * always editable. `origin === "registry"` packs are editable by their
 * owner — `owner_id` is the hub's login id (not `uuid`), matching
 * `HubUser.id` — or by any `admin`/`superuser` account, mirroring the hub's
 * own `isRegistryAdmin` policy (apps/hub/src/auth/access-policy.ts), which
 * already lets those roles submit new versions for *any* pack, not just
 * ones they published. `bundled`/`unknown` packs have no hub-side owner to
 * defer to at all, so they're never editable regardless of role. Unknown
 * ownership on a registry pack (e.g. installed before this field existed)
 * fails closed to read-only rather than assuming edit access.
 */
export function canEditPack(
  pack: Pick<InstalledPack, "origin" | "owner_id">,
  hubUser: HubUser | null,
): boolean {
  if (pack.origin === "local") return true;
  if (pack.origin !== "registry") return false;
  if (!hubUser) return false;
  if (hubUser.role === "admin" || hubUser.role === "superuser") return true;
  return pack.owner_id != null && pack.owner_id === hubUser.id;
}

/**
 * Whether a pack's name (and therefore its vault folder — the two are
 * always the same for local packs, see `hub_rename_pack` on the Rust side)
 * can be renamed. Deliberately narrower than `canEditPack`: a downloaded
 * pack's identity belongs to the hub, so even an admin/superuser who can
 * edit its *files* must not rename it — that identity is what every
 * published version is tracked under.
 */
export function canRenamePack(pack: Pick<InstalledPack, "origin">): boolean {
  return pack.origin === "local";
}
