#!/usr/bin/env bash
# Regenerates the brand-kit PR media from two record.mjs runs (before = merge base, after = branch).
# Run from the branch worktree root, with mise's FFmpeg (drawtext + libwebp) first on PATH:
#   RAW=<scratch>/raw KIT=<kit dir> bash .github/pr-media/brand-kit/make-media.sh
# RAW holds before/, after/, before.webm and after.webm from record.mjs; KIT is the `leclap brand` output folder
# (brand-kit.json, brand.theme.json) the after run imported.
set -euo pipefail

MEDIA=.github/pr-media/brand-kit
RAW=${RAW:?set RAW to the record.mjs output directory}
KIT=${KIT:?set KIT to the leclap brand output folder}
WORK=${WORK:-build/pr/brand-kit}
LECLAP="node packages/leclap-cli/dist/index.js"

# Before and after side by side, top-aligned on the ink ground, 32 px apart.
pair() {
  local name=$1 out=$2 scale=${3:-}
  local f="[0]${scale:+scale=$scale,}pad=iw+32:ih:0:0:color=0x141416[l];[1]${scale:+scale=$scale,}null[r];"
  f+="[l][r]xstack=inputs=2:layout=0_0|w0_0:fill=0x141416"
  ffmpeg -v error -y -i "$RAW/before/$name.png" -i "$RAW/after/$name.png" -filter_complex "$f" \
    -c:v libwebp -quality 82 "$MEDIA/$out.webp"
  echo "$out.webp: $(($(wc -c < "$MEDIA/$out.webp") / 1024)) KB"
}

pair dialog-1440 01-ai-dialog-1440 1440:-2
pair dialog-1440-box 02-brand-section-1440
pair dialog-390 03-ai-dialog-390

# The docs gallery's theme card (every colour and font a $color / $font token), rendered on the default leclap theme
# and on the kit's brand.theme.json, by the branch CLI.
mkdir -p "$WORK/themed"
node -e '
  const fs = require("node:fs");
  const [card, theme, dir] = process.argv.slice(1);
  const t = JSON.parse(fs.readFileSync(card, "utf8"));
  fs.writeFileSync(`${dir}/before.json`, JSON.stringify(t, null, 2));
  t.global.theme = JSON.parse(fs.readFileSync(theme, "utf8")).global.theme;
  t.sections[0].kinetic[0].text = { en: "THEME · STRIPE BRAND KIT" };
  fs.writeFileSync(`${dir}/after.json`, JSON.stringify(t, null, 2));
' docs/gallery/templates/themes/leclap.json "$KIT/brand.theme.json" "$WORK/themed"
for side in before after; do
  $LECLAP snapshot "$WORK/themed/$side.json" --at 2 --out "$WORK/themed/$side"
done
ffmpeg -v error -y -i "$WORK/themed/before/frame-01-2.00s.png" -i "$WORK/themed/after/frame-01-2.00s.png" \
  -filter_complex "[0]pad=iw+32:ih:0:0:color=0x141416[l];[l][1]xstack=inputs=2:layout=0_0|w0_0:fill=0x141416" \
  -c:v libwebp -quality 82 "$MEDIA/04-themed-card.webp"

# The evidence video: build.py composes the comparison, the LeClap CLI renders it.
mkdir -p "$WORK/raw"
cp "$RAW/before.webm" "$RAW/after.webm" "$WORK/raw/"
python3 examples/agentic-pr-video/evidence-skill/build.py \
  --content "$MEDIA/content.json" --work "$WORK" \
  --leclap "$LECLAP"
cp "$WORK"/*-brand-kit-evidence.mp4 "$WORK"/*-brand-kit-evidence.webp "$MEDIA/"
