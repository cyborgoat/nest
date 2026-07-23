import { describe, expect, it } from "vitest";
import { appErrorMessage } from "./errors";

describe("appErrorMessage", () => {
  it("keeps backend messages", () => {
    expect(appErrorMessage(new Error("Password is too short"))).toBe(
      "Password is too short",
    );
    expect(appErrorMessage({ message: "Account already exists" })).toBe(
      "Account already exists",
    );
  });

  it("joins validation message arrays and has a stable fallback", () => {
    expect(appErrorMessage({ message: ["Name is required", "ID is invalid"] })).toBe(
      "Name is required. ID is invalid",
    );
    expect(appErrorMessage(null, "Could not publish pack")).toBe(
      "Could not publish pack",
    );
  });
});
