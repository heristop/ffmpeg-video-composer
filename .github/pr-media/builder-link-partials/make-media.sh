#!/usr/bin/env bash
# Before/after pairs from the capture.mjs PNGs in build/pr/blp. Needs an ffmpeg with libwebp (mise's).
set -euo pipefail
cd "$(dirname "$0")/../../.."
for w in 1440 390; do
  ffmpeg -y -loglevel error -i build/pr/blp/before-$w.png -i build/pr/blp/after-$w.png \
    -filter_complex "[0][1]hstack,scale=iw/2:-2" -c:v libwebp -quality 82 \
    .github/pr-media/builder-link-partials/builder-link-$w.webp
done
