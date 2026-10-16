#!/usr/bin/env bash
# Regenerates the reference-structure PR media from two record.mjs runs (before = merge base, after = branch).
# Run from the branch worktree root, with mise's FFmpeg (drawtext + libwebp) first on PATH:
#   RAW=<scratch>/raw bash .github/pr-media/reference-structure/make-media.sh
# RAW holds before/, after/, before.webm and after.webm from record.mjs.
set -euo pipefail

MEDIA=.github/pr-media/reference-structure
RAW=${RAW:?set RAW to the record.mjs output directory}
WORK=${WORK:-build/pr/reference-structure}

# Before and after side by side, top-aligned on the ink ground, 32 px apart.
pair() {
  local name=$1 out=$2 scale=${3:-}
  local f="[0]${scale:+scale=$scale,}pad=iw+32:ih:0:0:color=0x141416[l];[1]${scale:+scale=$scale,}null[r];"
  f+="[l][r]xstack=inputs=2:layout=0_0|w0_0:fill=0x141416"
  ffmpeg -v error -y -i "$RAW/before/$name.png" -i "$RAW/after/$name.png" -filter_complex "$f" \
    -c:v libwebp -quality 82 "$MEDIA/$out.webp"
  echo "$out.webp: $(($(wc -c < "$MEDIA/$out.webp") / 1024)) KB"
}

pair ai-1440 01-ai-dialog-1440 1440:-2
pair ai-1440-box 02-ai-result-1440
pair ai-390 03-ai-dialog-390
pair advanced-1440-box 04-advanced-result-1440
pair advanced-390 05-advanced-390

# The evidence video: build.py composes the comparison, the LeClap CLI renders it.
mkdir -p "$WORK/raw"
cp "$RAW/before.webm" "$RAW/after.webm" "$WORK/raw/"
python3 examples/agentic-pr-video/evidence-skill/build.py \
  --content "$MEDIA/content.json" --work "$WORK" \
  --leclap "node packages/leclap-cli/dist/index.js"
cp "$WORK"/*-reference-structure-evidence.mp4 "$WORK"/*-reference-structure-evidence.webp "$MEDIA/"
