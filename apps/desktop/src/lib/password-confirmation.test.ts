import { describe, expect, it } from "vitest";
import {
  passwordsConfirmed,
  passwordsMismatch,
} from "./password-confirmation";

describe("password confirmation", () => {
  it("requires a non-empty matching confirmation", () => {
    expect(passwordsConfirmed("secret", "")).toBe(false);
    expect(passwordsConfirmed("secret", "different")).toBe(false);
    expect(passwordsConfirmed("secret", "secret")).toBe(true);
  });

  it("does not show a mismatch before confirmation starts", () => {
    expect(passwordsMismatch("secret", "")).toBe(false);
    expect(passwordsMismatch("secret", "different")).toBe(true);
    expect(passwordsMismatch("secret", "secret")).toBe(false);
  });
});
