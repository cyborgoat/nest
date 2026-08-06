import { describe, expect, it } from "vitest";
import {
  ensureImageExtension,
  isImagePath,
  isMarkdownPath,
  markdownForVaultDrop,
  relativeVaultPath,
} from "./vault-paths";

describe("vault-paths", () => {
  it("detects markdown and image paths", () => {
    expect(isMarkdownPath("pack/a.md")).toBe(true);
    expect(isImagePath("pack/pic.PNG")).toBe(true);
    expect(isImagePath("pack/a.md")).toBe(false);
  });

  it("builds relative vault paths", () => {
    expect(relativeVaultPath("pack/docs", "pack/docs/a.md")).toBe("./a.md");
    expect(relativeVaultPath("pack/docs", "pack/assets/pic.png")).toBe(
      "../assets/pic.png",
    );
    expect(relativeVaultPath("pack", "pack/pic.png")).toBe("./pic.png");
  });

  it("builds markdown for drops", () => {
    expect(markdownForVaultDrop("pack/note.md", "pack/pic.png")).toBe(
      "![pic](./pic.png)",
    );
    expect(markdownForVaultDrop("pack/docs/a.md", "pack/b.md")).toBe(
      "[b](../b.md)",
    );
  });

  it("preserves image extension on rename", () => {
    expect(ensureImageExtension("hero", "hero.png")).toBe("hero.png");
    expect(ensureImageExtension("hero.webp", "old.png")).toBe("hero.webp");
  });
});
