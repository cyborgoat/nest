import type { InstalledPack } from "@nest/shared";

export function pendingPublishVersionLabel(
  pack: Pick<
    InstalledPack,
    "pending_version" | "pending_request_type" | "pending_patch_revision"
  >,
): string {
  const version = pack.pending_version ? `v${pack.pending_version}` : "Pending";
  return pack.pending_request_type === "live_patch"
    ? `${version} · Patch ${pack.pending_patch_revision ?? "update"}`
    : version;
}
