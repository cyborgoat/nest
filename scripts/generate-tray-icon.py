#!/usr/bin/env python3
"""Generate macOS menu-bar template tray icons (white glyph, transparent bg).

Dock / .app icons come from `generate-app-icon.py` + `tauri icon`.
Menu-bar icons should be a monochrome template: white artwork with alpha only;
Nest enables `icon_as_template(true)` so macOS tints for light/dark.

Source: apps/desktop/public/nest-logo-transparent.png

Outputs under apps/desktop/src-tauri/icons/:
  tray-icon-22.png  (22×22 @1x)
  tray-icon.png     (44×44 @2x, used by Nest tray)
  tray-icon@2x.png  (88×88 spare)

Re-run this after `tauri icon`, which may overwrite files in icons/.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "apps/desktop/public/nest-logo-transparent.png"
OUT_DIR = ROOT / "apps/desktop/src-tauri/icons"


def force_white_alpha(im: Image.Image) -> Image.Image:
    """RGB must be pure white; shape lives only in alpha (macOS template-safe)."""
    rgba = im.convert("RGBA")
    r, g, b, a = rgba.split()
    white = Image.new("L", rgba.size, 255)
    # Soft threshold: kill dust, keep strokes.
    a = a.point(lambda v: 0 if v < 20 else min(255, int(v * 1.1)))
    return Image.merge("RGBA", (white, white, white, a))


def fit_square(src: Image.Image, size: int, pad_ratio: float = 0.12) -> Image.Image:
    """Center the glyph in a transparent square with menu-bar padding."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = max(1, int(round(size * pad_ratio)))
    inner = size - pad * 2

    bbox = src.getbbox()
    if bbox is None:
        return out
    cropped = src.crop(bbox)

    # Scale via alpha-aware resize, then re-force pure white (no gray fringes).
    cropped.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    cropped = force_white_alpha(cropped)

    x = (size - cropped.width) // 2
    y = (size - cropped.height) // 2
    out.paste(cropped, (x, y), cropped)
    return force_white_alpha(out)


def main() -> None:
    src = force_white_alpha(Image.open(SRC))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, size in [
        ("tray-icon-22.png", 22),
        ("tray-icon.png", 44),
        ("tray-icon@2x.png", 88),
    ]:
        icon = fit_square(src, size)
        icon.save(OUT_DIR / name, optimize=True)
        # Sanity: non-transparent pixels must be pure white.
        bad = sum(
            1
            for r, g, b, a in icon.getdata()
            if a > 0 and (r, g, b) != (255, 255, 255)
        )
        print(f"  {name}: {icon.size} bad_rgb={bad}")
    print(f"Wrote menu-bar template icons under {OUT_DIR}")


if __name__ == "__main__":
    main()
