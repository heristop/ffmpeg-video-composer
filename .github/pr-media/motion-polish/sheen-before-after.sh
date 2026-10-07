#!/usr/bin/env bash
# Builds 01-sheen-before-after.webp: the product-launch hero sweep, before (the shine_sweep APNG, as the
# previous showcase render of product-launch shows it) and after (the fx sheen, from `leclap snapshot`).
#   bash .github/pr-media/motion-polish/sheen-before-after.sh <before-strip.png> <after-frame-dir>
# <before-strip.png>: 8 tiles of 304x540 side by side, from the old showcase product-launch.mp4 at
#   t = 2.9 … 4.3 s (0.2 s apart). <after-frame-dir>: the frames of
#   leclap snapshot <product-launch with music off> --video video_1=examples/showcase/media/moo-mug.mp4 \
#     --at video_1.start+0.55,+0.7,+0.85,+1.0,+1.15,+1.3,+1.45,+1.8 (frame-01 … frame-08, 720x1280).
set -euo pipefail

BEFORE=$1
AFTER=$2
OUT=.github/pr-media/motion-polish/01-sheen-before-after.webp
FONT=packages/leclap-creative-kit/src/library/fonts/Oswald.ttf
MONO=packages/leclap-creative-kit/src/library/fonts/RobotoMono.ttf
T=300
BG=0x141416

inputs=(-i "$BEFORE")
chain=""
# Before: tiles 2-5 of the strip (t = 3.3, 3.5, 3.7, 3.9 s), cropped to the mug.
for i in 0 1 2 3; do
  x=$(((i + 2) * 3075 / 10 + 60))
  chain+="[0:v]crop=230:230:$x:175,scale=$T:$T:flags=lanczos[b$i];"
done
# After: frames 2-5 (0.7 … 1.15 s into the shot), the same region at 720x1280.
for i in 0 1 2 3; do
  frame=$(ls "$AFTER"/frame-0$((i + 2))-*.png)
  inputs+=(-i "$frame")
  chain+="[$((i + 1)):v]crop=545:545:142:414,scale=$T:$T:flags=lanczos[a$i];"
done
label() { # text size color
  printf "drawtext=fontfile=%s:text='%s':fontsize=%s:fontcolor=%s" "$FONT" "$1" "$2" "$3"
}
chain+="[b0][b1][b2][b3]hstack=4,pad=iw+60:ih+56:30:46:color=$BG,$(label 'BEFORE  shine_sweep.apng over the frame' 26 0x9A9AB0):x=30:y=8[top];"
chain+="[a0][a1][a2][a3]hstack=4,pad=iw+60:ih+56:30:46:color=$BG,$(label 'AFTER  fx sheen clipped to the product shot' 26 0xF5F3F7):x=30:y=8[bottom];"
chain+="[top][bottom]vstack,pad=iw:ih+20:0:0:color=$BG,"
chain+="drawtext=fontfile=$MONO:text='product-launch, the hero sweep across the Moo Mug, 0.15-0.2 s apart':fontsize=15:fontcolor=0x9A9AB0:x=30:y=h-24"
ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex "$chain" -frames:v 1 -c:v libwebp -quality 85 "$OUT"
ls -la "$OUT"
