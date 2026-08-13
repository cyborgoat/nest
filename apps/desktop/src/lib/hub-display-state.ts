export type HubDisplayState =
  | { kind: "loading" }
  | { kind: "setup-required" }
  | { kind: "connection-error"; message: string }
  | { kind: "account-required" }
  | { kind: "connected" };

export function deriveHubDisplayState({
  hubBaseUrl,
  online,
  authenticated,
  connectionMessage,
}: {
  hubBaseUrl: string | null;
  online: boolean | null;
  authenticated: boolean | null;
  connectionMessage?: string | null;
}): HubDisplayState {
  if (hubBaseUrl == null) return { kind: "loading" };
  if (!hubBaseUrl.trim()) return { kind: "setup-required" };
  if (online == null) return { kind: "loading" };
  if (!online) {
    return {
      kind: "connection-error",
      message: connectionMessage || "Hub is not accessible.",
    };
  }
  if (authenticated === false) return { kind: "account-required" };
  return { kind: "connected" };
}
