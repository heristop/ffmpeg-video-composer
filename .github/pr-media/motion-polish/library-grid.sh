#!/usr/bin/env bash
# Builds 02-library-grid.webp from the builder picker's posters (packages/leclap-creative-kit/src/library/
# animation-thumbs/*.png, rendered by the engine with `pnpm gen:animation-thumbs`): the 13 fx primitives
# (ripple and glint in two variants) and the three v2 strokes, grouped by family.
#   bash .github/pr-media/motion-polish/library-grid.sh
set -euo pipefail

THUMBS=packages/leclap-creative-kit/src/library/animation-thumbs
OUT=.github/pr-media/motion-polish/02-library-grid.webp
FONT=packages/leclap-creative-kit/src/library/fonts/Oswald.ttf
MONO=packages/leclap-creative-kit/src/library/fonts/RobotoMono.ttf
BG=0x141416
TILES=(
  "sheen:light" "leak:light" "edge-glow:light" "bloom:light" "ripple:marks" "ripple-tap:marks · tap"
  "glint:marks" "glint-orbit:marks · orbit" "confetti:marks" "bokeh:ambient" "dust:ambient" "vignette-breathe:ambient"
  "grain:ambient" "glass:surfaces" "resolve:surfaces" "frame:v2 stroke" "corners:v2 stroke" "underline:v2 stroke"
)
inputs=()
chain=""
labels=""
for i in "${!TILES[@]}"; do
  id=${TILES[$i]%%:*}
  family=${TILES[$i]#*:}
  inputs+=(-i "$THUMBS/$id.png")
  chain+="[$i:v]drawbox=x=0:y=0:w=iw:h=ih:color=0x2E2E38:t=1,pad=iw:ih+30:0:0:color=$BG,"
  chain+="drawtext=fontfile=$MONO:text='$id  ($family)':fontsize=15:fontcolor=0xE6E4EE:x=4:y=h-23[t$i];"
  labels+="[t$i]"
done
layout=""
for i in "${!TILES[@]}"; do
  layout+="$(((i % 6) * 328))_$(((i / 6) * 218))|"
done
chain+="${labels}xstack=inputs=${#TILES[@]}:layout=${layout%|}:fill=$BG,pad=iw+16:ih+88:8:80:color=$BG,"
chain+="drawtext=fontfile=$FONT:text='Light and effects\: every engine primitive in the builder picker':fontsize=30:fontcolor=0xF5F3F7:x=16:y=10,"
chain+="drawtext=fontfile=$MONO:text='posters rendered by the engine (pnpm gen\:animation-thumbs), 13 fx primitives + v2 strokes':fontsize=15:fontcolor=0x9A9AB0:x=16:y=50"
ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex "$chain" -frames:v 1 -c:v libwebp -quality 85 "$OUT"
ls -la "$OUT"
