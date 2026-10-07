#!/usr/bin/env bash
# Renders the motion-polish PR reel (motion-polish.mp4) with the branch CLI, and rebuilds the library grid.
# Run from the repository root after building the engine and the CLI:
#   pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
#   bash .github/pr-media/motion-polish/make-media.sh
# Needs ffmpeg (with libwebp) on PATH. Scratch output goes to build/pr-polish (git-ignored). The before/after
# sheets have their own scripts (sheen-before-after.sh, template-finishes.sh): their "before" side comes from
# renders of the previous state, see README.md.
set -euo pipefail

LECLAP="node packages/leclap-cli/dist/index.js"
MEDIA=.github/pr-media/motion-polish
REEL=examples/agentic-pr-video/motion-polish-reel.json
W=build/pr-polish
A=$W/assets
LIB=packages/leclap-creative-kit/src/library
H264=(-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 30)

# 1. Stage the assets. The engine only reads real files under --assets (no symlinks out of it).
mkdir -p "$A/videos/stand-in"
cp -r "$LIB/sfx" "$LIB/emoji" "$LIB/fonts" "$LIB/backgrounds" "$A/"

# 2. Stand-in footage: the bundled photographs set in motion (bundled clips are Git LFS objects).
clip() { # name photo filter
  [ -f "$A/videos/stand-in/$1" ] && return
  ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 30 -i "$LIB/backgrounds/$2" \
    -f lavfi -i anullsrc=r=44100:cl=stereo -vf "$3" "${H264[@]}" -c:a aac -b:a 64k -t 6 "$A/videos/stand-in/$1"
}
clip forest.mp4 forest-sea.jpg "scale=1600:-2,crop=1280:720:x='40+20*t':y=100"
clip sunset.mp4 golden-hour.jpg "scale=1600:-2,crop=1280:720:x='40+20*t':y=80"
clip desk.mp4 laptop-desk.jpg "zoompan=z='1+0.0008*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1280x720:fps=30"
clip flatlay.mp4 desk-flatlay.jpg "scale=1600:-2,crop=1280:720:x='200-20*t':y=90"

# 3. Validate, render and review the reel.
$LECLAP validate "$REEL"
$LECLAP render "$REEL" --assets "$A" --build "$W/build" --cache "$W/cache" -q -o "$W/motion-polish.raw.mp4"
$LECLAP snapshot "$REEL" --at-transitions --per-section --sheet 6x4 --assets "$A" --cache "$W/cache" --out "$W/review"

# 4. Delivery encode (the CLI encodes at the ultrafast preset).
ffmpeg -hide_banner -loglevel error -y -i "$W/motion-polish.raw.mp4" \
  -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 128k -shortest -movflags +faststart "$MEDIA/motion-polish.mp4"
ls -la "$MEDIA/motion-polish.mp4"

# 5. The library grid (posters from pnpm gen:animation-thumbs).
bash "$MEDIA/library-grid.sh"
