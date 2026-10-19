#!/usr/bin/env bash
# Rebuilds the evidence video. before.mp4 is a LeClap-free terminal card built from before.txt (the real
# validator output on main 7165eb08, reconstructed, not a screen recording); after.mp4 is the masks showcase preview.
set -euo pipefail
W=${1:-build/pr-media-masks}; mkdir -p "$W/raw"
ffmpeg -y -f lavfi -i color=c=0x14141c:s=1024x768:d=8:r=30 \
  -vf "drawtext=fontfile=/System/Library/Fonts/Menlo.ttc:textfile=$(dirname "$0")/before.txt:fontcolor=0xe8e8f0:fontsize=22:line_spacing=10:x=40:y=60" \
  -c:v libx264 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 "$W/raw/before.mp4"
ffmpeg -y -i apps/leclap-web/public/videos/showcase/masks.mp4 -an -c:v libx264 -pix_fmt yuv420p "$W/raw/after.mp4"
cp "$(dirname "$0")/content.json" "$W/content.json"
python3 examples/agentic-pr-video/evidence-skill/build.py --content "$W/content.json" --work "$W" --leclap "node packages/leclap-cli/dist/index.js"
