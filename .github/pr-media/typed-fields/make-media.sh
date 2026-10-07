#!/usr/bin/env bash
# Regenerates the typed-fields PR media: two renders of promo.json with different --set values, the
# side-by-side stills, the A-then-B clip and its animated WebP, and the CLI transcripts.
# Run from the repository root after building the engine and the CLI:
#   pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
#   bash .github/pr-media/typed-fields/make-media.sh
# Needs ffmpeg (drawtext, libx264, libwebp), python3 with Pillow. Scratch output: build/pr/typed-fields.
# The builder stills come from record.mjs (see README.md), not from this script.
set -euo pipefail

LECLAP="node packages/leclap-cli/dist/index.js"
MEDIA=.github/pr-media/typed-fields
TPL=$MEDIA/promo.json
W=build/pr/typed-fields
FONTS=packages/leclap-creative-kit/src/library/fonts
A_SET=(--set "TITLE=Spring Launch" --set "ACCENT=#b8adff" --set HOLD=3 --set STYLE=rise)
B_SET=(--set "TITLE=Night Market" --set "ACCENT=#ff6f61" --set HOLD=5 --set STYLE=slide-left)

mkdir -p "$W/assets"
cp -r "$FONTS" "$W/assets/"
rm -rf "$W/cache"

# 1. Validate, then render both versions.
$LECLAP validate "$TPL"
$LECLAP render "$TPL" "${A_SET[@]}" --assets "$W/assets" --build "$W/build-a" --cache "$W/cache" -q -o "$W/a.mp4"
$LECLAP render "$TPL" "${B_SET[@]}" --assets "$W/assets" --build "$W/build-b" --cache "$W/cache" -q -o "$W/b.mp4"

# 2. Labelled stills.
python3 "$MEDIA/stills.py" "$W/a.mp4" "$W/b.mp4" "$MEDIA"

# 3. A then B, each with its --set values in a strip at the bottom; then the inline animated WebP.
printf '%s' 'A  --set "TITLE=Spring Launch" --set ACCENT=#b8adff --set HOLD=3 --set STYLE=rise' > "$W/la.txt"
printf '%s' 'B  --set "TITLE=Night Market" --set ACCENT=#ff6f61 --set HOLD=5 --set STYLE=slide-left' > "$W/lb.txt"
strip() {
  echo "drawbox=x=0:y=ih-44:w=iw:h=44:color=0x141416@0.85:t=fill,drawtext=expansion=none:fontfile=$FONTS/RobotoMono.ttf:textfile=$1:fontcolor=0xF5F3F7:fontsize=18:x=20:y=h-31,setsar=1"
}
ffmpeg -hide_banner -loglevel error -y -i "$W/a.mp4" -i "$W/b.mp4" \
  -filter_complex "[0:v]$(strip "$W/la.txt")[a];[1:v]$(strip "$W/lb.txt")[b];[a][b]concat=n=2:v=1:a=0[v]" \
  -map "[v]" -an -r 30 -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart "$MEDIA/typed-fields.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$MEDIA/typed-fields.mp4" -vf "fps=15,scale=640:-2:flags=lanczos" \
  -c:v libwebp -loop 0 -quality 70 -compression_level 6 -an "$MEDIA/typed-fields.webp"

# 4. CLI transcripts (ANSI colours, the banner and the engine stack trace left out).
clean() { sed 's/\x1b\[[0-9;]*m//g' | grep -v -e '^▌' -e '^$' -e '^    at ' -e '^Stack:' -e '^Compilation error:' -e 'engine  ' -e 'assets  ' -e 'full log' || true; }
{
  echo '$ leclap resolve promo.json --set "TITLE=Night Market" --set ACCENT=#ff6f61 --set HOLD=5 --set STYLE=slide-left'
  echo '# excerpt: the resolved "global" (no "fields" left) and sections[1] ("title"): options and first three filters'
  $LECLAP resolve "$TPL" "${B_SET[@]}" 2> /dev/null | sed 's/\x1b\[[0-9;]*m//g' | python3 -c '
import json, sys
s = sys.stdin.read()
d = json.loads(s[s.index("{"):])
t = d["sections"][1]
print(json.dumps({"global": d["global"], "sections[1]": {"name": t["name"], "options": t["options"], "filters": t["filters"][:3]}}, indent=2))'
  echo
  echo '# the same slots in promo.json:'
  python3 -c '
import json, sys
t = json.load(open(sys.argv[1]))["sections"][1]
print(json.dumps({"options.duration": t["options"]["duration"], "filters[0].values.color": t["filters"][0]["values"]["color"],
  "filters[2].values.fontcolor": t["filters"][2]["values"]["fontcolor"], "filters[2].reveal.type": t["filters"][2]["reveal"]["type"]}, indent=2))' "$TPL"
} > "$MEDIA/cli-resolve.txt"

run_bad() {
  echo
  echo "\$ leclap render promo.json $1"
  set +e
  eval "$LECLAP render \"$TPL\" $1 --assets \"$W/assets\" --build \"$W/build-bad\" -o \"$W/bad.mp4\"" 2>&1 | clean
  local rc=${PIPESTATUS[0]}
  set -e
  echo "(exit $rc; no section was encoded)"
}
{
  echo '$ leclap validate promo.json'
  $LECLAP validate "$TPL" 2>&1 | clean
  run_bad '--set "TITLE=Night Market" --set HOLD=abc'
  run_bad '--set "TITLE=Night Market" --set ACCENT=#ff6f6'
  run_bad '--set "TITLE=Night Market" --set ACCENT=notacolor'
  run_bad '--set "TITLE=Night Market" --set STYLE=bounce'
  run_bad '--set HOLD=9'
} > "$MEDIA/cli-wrong-values.txt"

ls -l "$MEDIA"
