#!/usr/bin/env bash
# Rebuilds the evidence from four simulator stills (dev build, iPhone 16 Pro, iOS 18.6).
# Usage: make-media.sh <stills-dir> <work-dir>   (needs mise's ffmpeg on PATH)
set -euo pipefail
D=$1; W=$2; mkdir -p "$W/raw"
V="scale=-2:768,pad=1024:768:(ow-iw)/2:0:color=0x0c0d11,format=yuv420p"
T="-c:v libx264 -colorspace bt709 -color_primaries bt709 -color_trc bt709"
ffmpeg -y -loop 1 -framerate 30 -t 10 -i "$D/ios-worklet-error.png" -vf "$V" $T "$W/raw/before.mp4"
ffmpeg -y -loop 1 -framerate 30 -t 3 -i "$D/ios-after-fix4.png" -loop 1 -framerate 30 -t 7 -i "$D/ios-alltemplates-4.png" \
  -filter_complex "[0]scale=-2:768[a];[1]scale=-2:768[b];[a][b]concat=n=2:v=1:a=0,pad=1024:768:(ow-iw)/2:0:color=0x0c0d11,format=yuv420p" $T "$W/raw/after.mp4"
cp "$(dirname "$0")/content.json" "$W/content.json"
python3 examples/agentic-pr-video/evidence-skill/build.py --content "$W/content.json" --work "$W" --leclap "node packages/leclap-cli/dist/index.js"
