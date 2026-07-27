#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
icon_path="$script_dir/../../icons/app-icon-1024.png"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required to regenerate the NSIS installer artwork." >&2
  exit 1
fi

ffmpeg \
  -hide_banner \
  -loglevel error \
  -y \
  -f lavfi \
  -i "gradients=s=164x314:c0=0xfbf6ee:c1=0xead8c1:x0=0:y0=0:x1=164:y1=314:seed=1:speed=0" \
  -i "$icon_path" \
  -filter_complex \
  "[1:v]scale=124:124[logo];[0:v][logo]overlay=20:83,drawbox=x=20:y=238:w=76:h=3:color=0x9d6b3f:t=fill,drawbox=x=20:y=248:w=48:h=2:color=0x68462e@0.34:t=fill" \
  -frames:v 1 \
  -pix_fmt bgr24 \
  "$script_dir/installer-sidebar.bmp"

ffmpeg \
  -hide_banner \
  -loglevel error \
  -y \
  -f lavfi \
  -i "gradients=s=150x57:c0=0xffffff:c1=0xead8c1:x0=0:y0=0:x1=150:y1=0:seed=1:speed=0" \
  -i "$icon_path" \
  -filter_complex \
  "[1:v]scale=47:47[logo];[0:v][logo]overlay=99:5,drawbox=x=0:y=51:w=150:h=6:color=0xc08a55@0.10:t=fill" \
  -frames:v 1 \
  -pix_fmt bgr24 \
  "$script_dir/installer-header.bmp"
