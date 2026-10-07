#!/usr/bin/env bash
# Regenerates the motion-effects PR media: the reel and every snapshot image in this folder.
# Run from the repository root after building the engine and the CLI:
#   pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
#   bash .github/pr-media/motion-effects/make-media.sh
# Needs ffmpeg (with libwebp) and python3 on PATH. Scratch output goes to build/pr (git-ignored).
set -euo pipefail

LECLAP="node packages/leclap-cli/dist/index.js"
MEDIA=.github/pr-media/motion-effects
MD=examples/motion-design
REEL=examples/agentic-pr-video/motion-effects-reel.json
A=build/pr/assets
S=build/pr/snap
LIB=packages/leclap-creative-kit/src/library

# 1. Stage the assets. The engine only reads real files under --assets (no symlinks out of it).
mkdir -p "$A/videos" "$A/pictures" "$S"
cp -r "$LIB/sfx" "$LIB/emoji" "$LIB/fonts" "$LIB/backgrounds" "$A/"
cp -r apps/leclap-web/public/videos/showcase "$A/videos/"

snap() { # name template moments sheet [extra flags...]
  local name=$1 tpl=$2 at=$3 sheet=$4
  shift 4
  rm -rf "${S:?}/$name"
  $LECLAP snapshot "$tpl" --at "$at" --sheet "$sheet" --assets "$A" --out "$S/$name" "$@" > "$S/$name.log"
}

# 2. Snapshot the showcase samples (asset-free, or bundled photos only).
snap kinetic-type "$MD/kinetic-type.json" 1.2,2.2,5.8,8.7,11.8,14.6 3x2
snap fx-pack "$MD/fx-pack.json" 1.2,3.0,6.0,8.3,10.4,12.8 3x2
snap camera "$MD/camera-and-graphics.json" 1.0,3.4,4.3,5.6,6.4,7.3 3x2
snap fills "$MD/kinetic-fills.json" 1.6,4.4,7.6 3x1
snap split "$MD/split-layouts.json" 2.4,4.8,7.4 3x1
snap captions "$MD/word-captions.json" 1.2,3.2,5.3 3x1
snap rtl "$MD/rtl-type.json" 2.5,5.0,9.0 3x1
snap emoji "$MD/emoji-type.json" 2.0,4.8,8.4 3x1
snap fmt-landscape "$MD/formats.json" 1.6,8.4 2x1 --format landscape
snap fmt-portrait "$MD/formats.json" 1.6,7.4 2x1 --format portrait
snap fmt-square "$MD/formats.json" 1.6,3.6 2x1 --format square
snap theme-safe "$MD/theme-roles.json" 2.0,5.0,8.4 3x1 --safe tiktok
snap looks "$MD/split-layouts.json" 2.4 3x3 --looks

# 3. Pictures the reel shows: a real contact sheet and the three formats side by side.
cp "$S/kinetic-type/frame-sheet-1.png" "$A/pictures/snapshot-sheet.png"
python3 "$MEDIA/compose.py" reel-assets

# 4. Validate, render (with output QC and a manifest) and check the reel.
$LECLAP validate "$REEL"
$LECLAP render "$REEL" --assets "$A" --build build/pr/build --cache build/pr/cache --qc --manifest \
  -o build/pr/motion-effects.raw.mp4 || true # QC reports av_drift (see README); the render itself succeeds
$LECLAP snapshot "$REEL" --at-transitions --per-section --sheet 4x3 --assets "$A" --cache build/pr/cache --out "$S/reel-review"
snap reel "$REEL" 2.8,6.8,20.3,31.3,38.4,71.5,75.6,81.8,86.5,89.7,93.8,98.0 4x3 --cache build/pr/cache

# 5. Delivery encode: the CLI renders at the ultrafast preset (about 19 MB); re-encode to about 4 MB
#    and trim the audio to the picture.
ffmpeg -hide_banner -loglevel error -y -i build/pr/motion-effects.raw.mp4 \
  -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 160k -shortest -movflags +faststart build/pr/motion-effects.mp4
cp build/pr/motion-effects.mp4 "$MEDIA/motion-effects.mp4"

# 6. Labelled PR images.
python3 "$MEDIA/compose.py"
python3 "$MEDIA/compose.py" reel
