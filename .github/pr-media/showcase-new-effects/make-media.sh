#!/usr/bin/env bash
# Rebuilds the evidence video. before.mp4 is the layer-keyframes showcase preview on main 5439a319 (a real
# render, without motionBlur); after.mp4 is the preview from this branch.
# Run from the repository root after building the engine and the CLI, with the previews rendered.
set -euo pipefail
W=${1:-build/pr-media-showcase}; mkdir -p "$W/raw"
BEFORE=${BEFORE:-$W/before-layer-keyframes.mp4}   # git show 5439a319:apps/leclap-web/public/videos/showcase/layer-keyframes.mp4
enc=(-an -c:v libx264 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709)
ffmpeg -y -i "$BEFORE" "${enc[@]}" "$W/raw/before.mp4"
ffmpeg -y -i apps/leclap-web/public/videos/showcase/layer-keyframes.mp4 "${enc[@]}" "$W/raw/after.mp4"
cp "$(dirname "$0")/content.json" "$W/content.json"
python3 examples/agentic-pr-video/evidence-skill/build.py --content "$W/content.json" --work "$W" --leclap "node packages/leclap-cli/dist/index.js"
