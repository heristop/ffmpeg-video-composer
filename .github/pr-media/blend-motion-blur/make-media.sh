#!/usr/bin/env bash
# Regenerates the evidence. Run from the repo root with mise's ffmpeg on PATH.
# before = examples/motion-design/blend-motion-blur.json with blend/motionBlur stripped
# (before.template.json): main rejects those keys, see main-validate.txt.
set -euo pipefail
W=${1:?work dir}; D=.github/pr-media/blend-motion-blur; CLI="node packages/leclap-cli/dist/index.js"
A=packages/leclap-creative-kit/src/library
mkdir -p "$W/raw"
$CLI render $D/before.template.json --assets $A --build "$W/b" -o "$W/raw/before.mp4" -q
$CLI render examples/motion-design/blend-motion-blur.json --assets $A --build "$W/a" -o "$W/raw/after.mp4" -q
cp $D/content.json "$W/content.json"
python3 examples/agentic-pr-video/evidence-skill/build.py --content "$W/content.json" --work "$W" --leclap "$CLI"
for t in 1.4 3.5; do
  ffmpeg -y -ss $t -i "$W/raw/before.mp4" -frames:v 1 "$W/b-$t.png"
  ffmpeg -y -ss $t -i "$W/raw/after.mp4" -frames:v 1 "$W/a-$t.png"
  ffmpeg -y -i "$W/b-$t.png" -i "$W/a-$t.png" -filter_complex hstack -frames:v 1 "$W/pair-$t.png"
done
ffmpeg -y -i "$W/pair-1.4.png" -c:v libwebp -quality 82 $D/blend-before-after.webp
ffmpeg -y -i "$W/pair-3.5.png" -c:v libwebp -quality 82 $D/motion-blur-before-after.webp
