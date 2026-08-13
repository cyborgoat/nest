import { describe, expect, it } from "vitest";
import { deriveHubDisplayState } from "./hub-display-state";

describe("deriveHubDisplayState", () => {
  it("waits for settings before choosing a visible state", () => {
    expect(
      deriveHubDisplayState({
        hubBaseUrl: null,
        online: null,
        authenticated: null,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("prioritizes a missing Hub URL over the offline result", () => {
    expect(
      deriveHubDisplayState({
        hubBaseUrl: "  ",
        online: false,
        authenticated: false,
      }),
    ).toEqual({ kind: "setup-required" });
  });

  it("preserves the connection error message for a configured Hub", () => {
    expect(
      deriveHubDisplayState({
        hubBaseUrl: "https://hub.example.com",
        online: false,
        authenticated: false,
        connectionMessage: "Connection timed out",
      }),
    ).toEqual({
      kind: "connection-error",
      message: "Connection timed out",
    });
  });

  it("shows account guidance only after the Hub is online", () => {
    expect(
      deriveHubDisplayState({
        hubBaseUrl: "https://hub.example.com",
        online: true,
        authenticated: false,
      }),
    ).toEqual({ kind: "account-required" });
  });

  it("has no actionable notice for a connected authenticated user", () => {
    expect(
      deriveHubDisplayState({
        hubBaseUrl: "https://hub.example.com",
        online: true,
        authenticated: true,
      }),
    ).toEqual({ kind: "connected" });
  });
});
