#!/usr/bin/env bash
# Regenerates the WebMCP PR media: the builder footage, the reel rendered by the LeClap CLI, and the stills.
# Run from the repository root after building the engine and the CLI:
#   pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
#   bash .github/pr-media/webmcp/make-media.sh
# Needs ffmpeg (with libx264 and libwebp) and python3 on PATH, and a Chromium for @playwright/test
# (CHROMIUM=/path/to/chrome to pick one). Scratch output goes to build/pr/webmcp (git-ignored).
set -euo pipefail

LECLAP="node packages/leclap-cli/dist/index.js"
MEDIA=.github/pr-media/webmcp
REEL=examples/agentic-pr-video/webmcp-reel.json
W=build/pr/webmcp
A=$W/assets
LIB=packages/leclap-creative-kit/src/library
WEB=apps/leclap-web
PORT=5393
VITE_PID=""
RESTORE_PLACEHOLDERS=0

cleanup() {
  if [ -n "$VITE_PID" ]; then kill "$VITE_PID" 2> /dev/null || true; fi
  # The placeholder clips are Git LFS pointers in a checkout without LFS: put the pointers back.
  if [ "$RESTORE_PLACEHOLDERS" = 1 ]; then
    git checkout -- "$WEB/public/videos/placeholder-landscape.mp4" "$WEB/public/videos/placeholder-portrait.mp4"
  fi
}
trap cleanup EXIT

# 1. Stage the engine assets. The engine only reads real files under --assets (no symlinks out of it).
mkdir -p "$A/videos/webmcp"
cp -r "$LIB/sfx" "$LIB/fonts" "$LIB/emoji" "$A/"

# 2. The builder's Preview render feeds placeholder clips to ffmpeg.wasm. Without LFS they are pointers,
#    so render them locally (the app's own script) and restore the pointers on exit.
if [ "$(wc -c < "$WEB/public/videos/placeholder-landscape.mp4")" -lt 1024 ]; then
  RESTORE_PLACEHOLDERS=1
  bash "$WEB/scripts/render-placeholder.sh"
fi

# 3. Serve the builder (dev build: the WebMCP polyfill and its testing shim) and record the takes.
(cd "$WEB" && node ../../scripts/copy-core-assets.ts > /dev/null && node scripts/stage-ffmpeg-core.ts > /dev/null)
(cd "$WEB" && exec npx vite --port "$PORT" --strictPort > /dev/null 2>&1) &
VITE_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/" > /dev/null && break
  sleep 1
done
BASE="http://localhost:$PORT" node "$MEDIA/record.mjs"

# 4. Validate, render (with output QC) and review the reel.
$LECLAP validate "$REEL"
$LECLAP render "$REEL" --assets "$A" --build "$W/build" --cache "$W/cache" --qc -o "$W/webmcp.raw.mp4" || true # QC may flag av_drift (see README)
$LECLAP snapshot "$REEL" --at-transitions --per-section --sheet 4x3 --assets "$A" --cache "$W/cache" --out "$W/review"

# 5. Delivery encode: the CLI renders landscape at 1280x720 (ultrafast preset). Scale to 1920x1080 with
#    lanczos, re-encode at a delivery preset and trim the audio to the picture.
ffmpeg -hide_banner -loglevel error -y -i "$W/webmcp.raw.mp4" \
  -vf "scale=1920:1080:flags=lanczos" -r 30 \
  -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 128k -shortest -movflags +faststart "$MEDIA/webmcp.mp4"

# 6. Stills of the reel (WebP, 1280 px wide: the render's own resolution).
python3 "$MEDIA/stills.py"
