#!/usr/bin/env python3
"""Build the macOS Dock / app-bundle master icon from nest.png.

macOS only auto-applies the Big Sur "squircle" mask to icons compiled
through Xcode's asset catalog. A plain opaque full-bleed square .icns (no
alpha) instead gets the OS's legacy-icon compatibility treatment: shrunk
and centered on a white rounded-rect backplate — which reads as unrounded
and undersized next to properly masked apps. So we bake the squircle mask
(with transparent corners) into the artwork ourselves.

Usage:
  python3 scripts/generate-app-icon.py
  cd apps/desktop && npx tauri icon src-tauri/icons/app-icon-1024.png
  python3 scripts/generate-tray-icon.py   # restore menu-bar badge after tauri icon
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "apps/desktop/public/nest.png"
OUT = ROOT / "apps/desktop/src-tauri/icons/app-icon-1024.png"


def squircle_mask(size: int, supersample: int = 4, exponent: float = 5.0) -> Image.Image:
    """Alpha mask shaped like macOS's Big Sur app-icon squircle, edge-to-edge."""
    hi = size * supersample
    coords = (np.arange(hi) + 0.5 - hi / 2) / (hi / 2)
    nx, ny = np.meshgrid(np.abs(coords), np.abs(coords))
    inside = (nx**exponent + ny**exponent) <= 1.0
    mask = (inside * 255).astype(np.uint8)
    return Image.fromarray(mask).resize((size, size), Image.Resampling.LANCZOS)


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

    rgba = canvas.convert("RGBA")
    rgba.putalpha(squircle_mask(size))

    # Apple's own icons don't fill the 1024 canvas edge-to-edge — the squircle
    # itself sits inset within it (~80% of the canvas), which is what makes a
    # full-bleed mask read as "too big" next to standard apps in the Dock.
    icon_scale = 0.80
    plate = rgba.resize(
        (round(size * icon_scale), round(size * icon_scale)), Image.Resampling.LANCZOS
    )
    padded = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = (size - plate.width) // 2
    padded.paste(plate, (offset, offset), plate)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    padded.save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} ({padded.size[0]}×{padded.size[1]} {padded.mode})")


if __name__ == "__main__":
    main()
