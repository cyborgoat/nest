#!/usr/bin/env python3
"""Generate Windows-specific app and tray icons from the Nest artwork.

The macOS app master is intentionally inset to match Dock icon sizing. Windows
uses a larger plate so the taskbar icon matches native Windows applications.
The tray icon is colored because Windows does not tint macOS template images.

Outputs under apps/desktop/src-tauri/icons/:
  windows-icon.png       (256×256 source preview)
  windows-icon.ico       (multi-resolution executable/bundle icon)
  windows-tray-icon.png  (32×32 colored notification-area icon)
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "apps/desktop/public/nest.png"
OUT_DIR = ROOT / "apps/desktop/src-tauri/icons"


def squircle_mask(size: int, supersample: int = 4, exponent: float = 5.0) -> Image.Image:
    hi = size * supersample
    coords = (np.arange(hi) + 0.5 - hi / 2) / (hi / 2)
    nx, ny = np.meshgrid(np.abs(coords), np.abs(coords))
    inside = (nx**exponent + ny**exponent) <= 1.0
    return Image.fromarray((inside * 255).astype(np.uint8)).resize(
        (size, size), Image.Resampling.LANCZOS
    )


def make_windows_icon(size: int = 256, plate_scale: float = 0.94) -> Image.Image:
    src = Image.open(SRC).convert("RGB")
    cream = src.getpixel((10, 10))
    margin = int(size * 0.06)
    inner = size - margin * 2

    canvas = Image.new("RGB", (size, size), cream)
    scale = max(inner / src.width, inner / src.height)
    resized = src.resize(
        (round(src.width * scale), round(src.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - inner) // 2
    top = (resized.height - inner) // 2
    canvas.paste(resized.crop((left, top, left + inner, top + inner)), (margin, margin))

    plate = canvas.convert("RGBA")
    plate.putalpha(squircle_mask(size))
    if plate_scale == 1:
        return plate

    scaled_size = round(size * plate_scale)
    plate = plate.resize((scaled_size, scaled_size), Image.Resampling.LANCZOS)
    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    offset = (size - scaled_size) // 2
    output.paste(plate, (offset, offset), plate)
    return output


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    icon = make_windows_icon()
    icon.save(OUT_DIR / "windows-icon.png", optimize=True)
    icon.save(
        OUT_DIR / "windows-icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    tray = make_windows_icon(size=32, plate_scale=1)
    tray.save(OUT_DIR / "windows-tray-icon.png", optimize=True)

    print("Wrote Windows app icon, multi-resolution ICO, and colored tray icon")


if __name__ == "__main__":
    main()
