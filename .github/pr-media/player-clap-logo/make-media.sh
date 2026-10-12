#!/usr/bin/env bash
# Builds the start-clap PR media from record.mjs's output (and the loader stills, see record.mjs): still WebP
# strips and pairs, and the LeClap evidence video.
# Usage: bash .github/pr-media/player-clap-logo/make-media.sh <work-dir>   (from the repo root)
# Needs mise's ffmpeg on PATH (drawtext, libwebp) and the CLI built: pnpm --filter @leclap/cli build.
set -euo pipefail
here=.github/pr-media/player-clap-logo
work=$1
crop="crop=240:200:252:387"
# Four moments of the clap per side, the click at about 2.86 s (before) and 2.74 s (after).
strip() { # side t1 t2 t3 t4
  local inputs=() i=0
  for t in "${@:2}"; do inputs+=(-ss "$t" -i "$work/raw/$1.webm"); done
  ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex \
    "[0:v]$crop[a];[1:v]$crop[b];[2:v]$crop[c];[3:v]$crop[d];[a][b][c][d]hstack=inputs=4" -frames:v 1 \
    "$work/raw/$1-strip.png"
}
strip before 2.9 2.98 3.06 3.18
strip after 2.78 2.9 3.02 3.18
ffmpeg -hide_banner -loglevel error -y -i "$work/raw/before-strip.png" -i "$work/raw/after-strip.png" \
  -filter_complex "vstack=inputs=2,scale=1440:-2" -c:v libwebp -quality 82 "$here/clap-frames.webp"
for view in 1440-light 1440-dark; do
  ffmpeg -hide_banner -loglevel error -y -i "$work/raw/before-loader-$view.png" -i "$work/raw/after-loader-$view.png" \
    -filter_complex "[0:v]scale=-2:720[a];[1:v]scale=-2:720[b];[a][b]hstack=inputs=2" \
    -c:v libwebp -quality 82 "$here/loader-$view.webp"
done
for side in before after; do
  ffmpeg -hide_banner -loglevel error -y -i "$work/raw/$side.webm" -vf "crop=704:712:0:0,fps=30" \
    -c:v libx264 -crf 18 -pix_fmt yuv420p "$work/raw/$side-crop.mp4"
done
python3 examples/agentic-pr-video/evidence-skill/build.py --content "$here/content.json" --work "$work" \
  --logo apps/leclap-web/public/favicon.svg --leclap "node packages/leclap-cli/dist/index.js"
