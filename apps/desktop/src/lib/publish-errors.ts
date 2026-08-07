import { appErrorMessage } from "@/lib/errors";

/**
 * Publish-failure toast text. Picks a kind-specific fallback for non-Error
 * rejections, then special-cases the one error an older desktop build can
 * actually produce: `hub_publish_live_patch` only exists in newer builds,
 * so a stale installation trying to submit a live patch gets a Tauri "no
 * such command" error whose message literally contains that command name —
 * surfacing that raw text would be confusing, so it's replaced with an
 * actionable instruction instead.
 */
export function publishErrorMessage(
  error: unknown,
  kind: "release" | "live_patch",
): string {
  const fallback =
    kind === "live_patch"
      ? "Could not submit live patch"
      : "Could not publish release";
  const message = appErrorMessage(error, fallback);
  return message.includes("hub_publish_live_patch")
    ? "Restart the desktop app to enable live patch publishing"
    : message;
}
