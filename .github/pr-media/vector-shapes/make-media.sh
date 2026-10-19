#!/usr/bin/env bash
# Renders examples/motion-design/vector-shapes.json with the branch CLI and cuts the stills in this folder.
# Needs an FFmpeg with drawtext and libwebp (mise's) first on PATH. Run from the repo root.
set -euo pipefail

out=.github/pr-media/vector-shapes
video=$out/leclap-vector-shapes-evidence.mp4

node packages/leclap-cli/dist/index.js render examples/motion-design/vector-shapes.json -o "$video"

still() { ffmpeg -v error -y -ss "$1" -i "$video" -frames:v 1 -c:v libwebp -quality 82 "$out/$2.webp"; }

still 1.6 star-hexagon
still 3.4 heart-drawing
still 4.4 heart-arrow
still 7.6 blob-icon
