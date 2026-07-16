#!/usr/bin/env python3
"""Build the macOS Dock / app-bundle master icon from nest.png.

Dock icons must be an opaque full-bleed square. macOS applies the squircle
mask itself — do not bake rounded corners into this artwork.

Usage:
  python3 scripts/generate-app-icon.py
  cd apps/desktop && npx tauri icon src-tauri/icons/app-icon-1024.png
  python3 scripts/generate-tray-icon.py   # restore menu-bar badge after tauri icon
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "apps/desktop/public/nest.png"
OUT = ROOT / "apps/desktop/src-tauri/icons/app-icon-1024.png"


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    cream = src.getpixel((10, 10))
    size = 1024
    margin = int(size * 0.08)
    inner = size - margin * 2

    canvas = Image.new("RGB", (size, size), cream)
    w, h = src.size
    scale = max(inner / w, inner / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - inner) // 2
    top = (nh - inner) // 2
    cropped = resized.crop((left, top, left + inner, top + inner))
    canvas.paste(cropped, (margin, margin))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} ({canvas.size[0]}×{canvas.size[1]} {canvas.mode})")


if __name__ == "__main__":
    main()
