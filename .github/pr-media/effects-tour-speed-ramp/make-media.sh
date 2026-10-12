#!/usr/bin/env bash
# Builds the speed-ramp PR media: the effects tour's ramp chapter cut from the base branch and from this branch,
# a strip of consecutive bullet-time frames per side, and the LeClap evidence video.
# Usage: bash .github/pr-media/effects-tour-speed-ramp/make-media.sh <work-dir> [base-ref]   (from the repo root)
# Needs mise's ffmpeg on PATH (drawtext, libwebp) and the CLI built: pnpm --filter @leclap/cli build.
set -euo pipefail
here=.github/pr-media/effects-tour-speed-ramp
work=$1
base=${2:-origin/main}
tour=apps/leclap-web/public/videos/showcase/effects-tour.mp4
mkdir -p "$work/raw"
git show "$base:$tour" > "$work/raw/before-tour.mp4"
cp "$tour" "$work/raw/after-tour.mp4"
for side in before after; do
  ffmpeg -hide_banner -loglevel error -y -ss 318 -t 15 -i "$work/raw/$side-tour.mp4" -an \
    -c:v libx264 -crf 16 -pix_fmt yuv420p "$work/raw/$side.mp4"
  # Six consecutive frames in bullet time (0.2x), the same crop on both sides. The base branch's longer clip
  # ranges reach 0.2x later in the section.
  at=$([ "$side" = before ] && echo 8.8 || echo 8.2)
  ffmpeg -hide_banner -loglevel error -y -ss "$at" -i "$work/raw/$side.mp4" \
    -vf "crop=480:270:400:225,tile=6x1:padding=6:color=0x141416" -frames:v 1 "$work/raw/$side-strip.png"
done
ffmpeg -hide_banner -loglevel error -y -i "$work/raw/before-strip.png" -i "$work/raw/after-strip.png" \
  -filter_complex "[0:v][1:v]vstack=inputs=2,scale=1920:-2" -c:v libwebp -quality 82 "$here/bullet-frames.webp"
python3 examples/agentic-pr-video/evidence-skill/build.py --content "$here/content.json" --work "$work" \
  --logo apps/leclap-web/public/favicon.svg --leclap "node packages/leclap-cli/dist/index.js"
