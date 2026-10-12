#!/usr/bin/env bash
# Builds the player-loader PR media from record.mjs's output: still WebP pairs and the LeClap evidence video.
# Usage: bash .github/pr-media/player-logo-loader/make-media.sh <work-dir>   (from the repo root)
# Needs mise's ffmpeg on PATH (drawtext, libwebp) and the CLI built: pnpm --filter @leclap/cli build.
set -euo pipefail
here=.github/pr-media/player-logo-loader
work=$1
for view in 1440-light 1440-dark; do
  ffmpeg -hide_banner -loglevel error -y -i "$work/raw/before-$view.png" -i "$work/raw/after-$view.png" \
    -filter_complex "[0:v]scale=-2:720[a];[1:v]scale=-2:720[b];[a][b]hstack=inputs=2" \
    -c:v libwebp -quality 82 "$here/loader-$view.webp"
done
# The header (its logo) and the player, cropped out of the 1024x768 recording.
for side in before after; do
  ffmpeg -hide_banner -loglevel error -y -i "$work/raw/$side.webm" -vf "crop=704:712:0:0,fps=30" \
    -c:v libx264 -crf 18 -pix_fmt yuv420p "$work/raw/$side-crop.mp4"
done
python3 examples/agentic-pr-video/evidence-skill/build.py --content "$here/content.json" --work "$work" \
  --logo apps/leclap-web/public/favicon.svg --leclap "node packages/leclap-cli/dist/index.js"
