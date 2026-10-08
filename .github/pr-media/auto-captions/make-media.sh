#!/usr/bin/env bash
# Regenerates the auto-captions PR media: the pinned template, the CLI outputs, the render and its stills.
# Run from the repository root after building the engine and the CLI:
#   pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
#   bash .github/pr-media/auto-captions/make-media.sh
# Needs ffmpeg (drawtext, libx264, libwebp), python3, whisper.cpp (`brew install whisper-cpp`) and the
# base model (`leclap transcribe --download-model` fetches it once). Scratch output goes to build/pr.
# REBUILD_CLIP=1 re-synthesises talk.mp4 with macOS `say`; BUILDER=1 also shoots the builder still.
set -euo pipefail

LECLAP="node packages/leclap-cli/dist/index.js"
MEDIA=.github/pr-media/auto-captions
W=build/pr/auto-captions
A=$W/assets
LIB=packages/leclap-creative-kit/src/library
PORT=5394

# 1. The source clip: a synthesised voice over a slow zoom on a bundled photo (0.4 s lead, 0.6 s tail).
if [ "${REBUILD_CLIP:-0}" = 1 ] || [ ! -f "$MEDIA/talk.mp4" ]; then
  mkdir -p "$W"
  say -v Samantha -r 185 -o "$W/speech.aiff" \
    "Every word you say becomes a caption. The speech is transcribed on your own machine, the words are pinned in the template, and the next render looks exactly the same."
  ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$LIB/backgrounds/cafe-table.jpg" -i "$W/speech.aiff" \
    -filter_complex "[0:v]crop=506:900:360:0,scale=1440:2560:flags=lanczos,zoompan=z='1+0.12*on/290':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=720x1280:fps=30,format=yuv420p[v];[1:a]adelay=400|400,apad=pad_dur=0.6,aresample=48000,pan=mono|c0=c0[a]" \
    -map "[v]" -map "[a]" -frames:v 291 -t 9.7 -c:v libx264 -preset slow -crf 26 -profile:v high \
    -movflags +faststart -c:a aac -b:a 96k -ac 1 "$MEDIA/talk.mp4"
fi

# 2. Transcribe once and pin the words; the SRT of the clip itself.
$LECLAP transcribe "$MEDIA/talk.json" --video "talk=$MEDIA/talk.mp4" --out "$MEDIA/talk.pinned.json" | tee "$W/pin.log"
$LECLAP transcribe "$MEDIA/talk.mp4" --srt --language en > "$MEDIA/talk.srt"
python3 - "$MEDIA" << 'EOF'
import json, sys
media = sys.argv[1]
d = json.load(open(f'{media}/talk.pinned.json'))
sub = d['sections'][1]['subtitles']
words = ',\n'.join('    ' + json.dumps(w) for w in sub['words'][:4])
open(f'{media}/transcribe-pin.txt', 'w').write(f'''$ leclap transcribe {media}/talk.json \\
    --video talk={media}/talk.mp4 \\
    --out {media}/talk.pinned.json
✓ talk: pinned {len(sub['words'])} words (whisper.cpp {d['meta']['resolved']['transcripts']['talk']['model']}, en, confidence {d['meta']['resolved']['transcripts']['talk']['confidence']})
  › wrote {media}/talk.pinned.json

# talk.pinned.json, section "talk": `transcribe` is replaced by the words (first 4 of {len(sub['words'])})
"subtitles": {{
  "words": [
{words},
    …
  ],
  "style": "{sub['style']}",
  "size": {sub['size']},
  "karaoke": "{sub['karaoke']}"
}}

# talk.pinned.json, meta.resolved
"resolved": {json.dumps(d['meta']['resolved'], indent=2)}
''')
EOF

# 3. Render the pinned template (the engine reads real files under --assets only).
mkdir -p "$A/videos"
cp -r "$LIB/fonts" "$LIB/sfx" "$A/"
cp "$MEDIA/talk.mp4" "$A/videos/talk.mp4"
$LECLAP render "$MEDIA/talk.pinned.json" --assets "$A" --build "$W/build" --cache "$W/cache" -o "$W/talk.raw.mp4"

# 4. Delivery encode, animated preview, contact sheet and one still.
ffmpeg -hide_banner -loglevel error -y -i "$W/talk.raw.mp4" \
  -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 96k -shortest -movflags +faststart "$MEDIA/talk-captions.mp4"
ffmpeg -hide_banner -loglevel error -y -ss 0.8 -i "$MEDIA/talk-captions.mp4" \
  -vf "fps=10,scale=360:640:flags=lanczos" -c:v libwebp -quality 42 -compression_level 6 -loop 0 -an \
  "$MEDIA/talk-captions.webp"
python3 "$MEDIA/sheet.py" "$W/talk.raw.mp4" "$MEDIA/talk.pinned.json" "$A/fonts/RobotoMono.ttf" "$MEDIA/karaoke-sheet.webp"
ffmpeg -hide_banner -loglevel error -y -ss 4.45 -i "$MEDIA/talk-captions.mp4" -frames:v 1 \
  -vf "scale=540:960:flags=lanczos" -c:v libwebp -quality 72 "$MEDIA/frame.webp"

# 5. Optional: the builder's pinned-words editor, against a dev server of the web app.
if [ "${BUILDER:-0}" = 1 ]; then
  # copy-core-assets also stages real music over the Expo app's LFS pointers: put back only what it changed.
  BEFORE=$(git diff --name-only -- apps/leclap-expo/assets)
  (cd apps/leclap-web && node ../../scripts/copy-core-assets.ts > /dev/null)
  CHANGED=$(comm -13 <(echo "$BEFORE") <(git diff --name-only -- apps/leclap-expo/assets))
  if [ -n "$CHANGED" ]; then echo "$CHANGED" | xargs git checkout --; fi
  (cd apps/leclap-web && exec npx vite --port "$PORT" --strictPort > /dev/null 2>&1) &
  VITE_PID=$!
  trap 'kill "$VITE_PID" 2> /dev/null || true' EXIT
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:$PORT/" > /dev/null && break
    sleep 1
  done
  BASE="http://localhost:$PORT" node "$MEDIA/builder-still.mjs" "$W/builder.png"
  ffmpeg -hide_banner -loglevel error -y -i "$W/builder.png" -vf "crop=820:990:0:264" \
    -c:v libwebp -quality 70 "$MEDIA/builder-pinned-words.webp"
fi
