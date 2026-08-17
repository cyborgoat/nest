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

export function formatPendingSubmitter(
  pack: Pick<InstalledPack, "pending_submitter_id" | "pending_submitter_name">,
): string | null {
  if (pack.pending_submitter_name) {
    return `${pack.pending_submitter_name}${
      pack.pending_submitter_id ? ` (@${pack.pending_submitter_id})` : ""
    }`;
  }
  return pack.pending_submitter_id ? `@${pack.pending_submitter_id}` : null;
}

export function publishMenuLabel(authenticated: boolean): string {
  return authenticated ? "Publish" : "Sign in to publish";
}

export function publishBlockedReason(
  pack: Pick<
    InstalledPack,
    "pending_version" | "publish_review_status"
  >,
): string | undefined {
  if (pack.publish_review_status === "approved_awaiting_merge") {
    return "Finish merging the approved release before publishing again.";
  }
  if (pack.pending_version) {
    return "A publish request is already under review.";
  }
  return undefined;
}

export function isPublishMenuDisabled(
  pack: Pick<InstalledPack, "pending_version">,
): boolean {
  return Boolean(pack.pending_version);
}
