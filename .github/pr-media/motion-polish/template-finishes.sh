#!/usr/bin/env bash
# Builds 03-template-finishes.webp: four bundled-template moments before and after the fx pass, from two
# `pnpm motion:review:templates` runs (the "before" run at the commit before the fx pass, the "after" run on
# this branch). Footage is the harness's stand-in gradient (bundled clips are Git LFS objects).
#   bash .github/pr-media/motion-polish/template-finishes.sh <review-out-dir>
# <review-out-dir> holds before/frames/template__<id>/ and after/frames/template__<id>/.
set -euo pipefail

R=$1
OUT=.github/pr-media/motion-polish/03-template-finishes.webp
FONT=packages/leclap-creative-kit/src/library/fonts/Oswald.ttf
MONO=packages/leclap-creative-kit/src/library/fonts/RobotoMono.ttf
BG=0x141416
W=600
ROWS=(
  "interview:frame-03-9.10s:smoked glass under the lower third, v2 corners on the subject"
  "present-yourself:frame-01-0.80s:bokeh behind the intro card"
  "present-yourself:frame-03-4.27s:edge-glow on the name band, vignette-breathe instead of a fixed vignette"
  "photo-backdrop:frame-01-1.03s:warm bloom on the sky, one v2 frame with its own shadow"
)
inputs=()
chain=""
stack=""
for i in "${!ROWS[@]}"; do
  IFS=: read -r id frame caption <<< "${ROWS[$i]}"
  inputs+=(-i "$R/before/frames/template__$id/$frame.png" -i "$R/after/frames/template__$id/$frame.png")
  b=$((2 * i))
  a=$((2 * i + 1))
  chain+="[$b:v]scale=$W:-2:flags=lanczos[b$i];[$a:v]scale=$W:-2:flags=lanczos[a$i];"
  chain+="[b$i][a$i]hstack,pad=iw+40:ih+44:20:36:color=$BG,"
  chain+="drawtext=fontfile=$MONO:text='$id at ${frame##*-}':fontsize=16:fontcolor=0xF5F3F7:x=20:y=10,"
  chain+="drawtext=fontfile=$MONO:text='$caption':fontsize=15:fontcolor=0x9A9AB0:x=330:y=11[r$i];"
  stack+="[r$i]"
done
chain+="${stack}vstack=${#ROWS[@]},pad=iw:ih+64:0:64:color=$BG,"
chain+="drawtext=fontfile=$FONT:text='Template finishes\: before the fx pass (left) and after (right)':fontsize=28:fontcolor=0xF5F3F7:x=20:y=14"
ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex "$chain" -frames:v 1 -c:v libwebp -quality 82 "$OUT"
ls -la "$OUT"
