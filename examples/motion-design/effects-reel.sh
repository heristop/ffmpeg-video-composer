#!/usr/bin/env bash
# Cuts the landing's effects reel (apps/leclap-web/public/videos/home/effects-reel*) from the effects tour's
# chapters: ten moments on the beat of the tour's own lo-fi bed, 20 s, looping cleanly. Two cuts:
#   effects-reel.{mp4,webm,webp}           1280x720
#   effects-reel-portrait.{mp4,webm,webp}  720x1280, the same chapters rendered in portrait by the engine
#                                          (global.orientation swapped), so every layout is the engine's own
#                                          vertical layout, not a crop
# Both cuts render their own variant of chapters 01-05 (step 1): the tour's corner chapter label ("05 COMPOSITING &
# LIGHT") is dropped, since a reel mixes chapters and the label collided with the longer effect labels top left
# ("layout · split · horizontal · 3 panes · gap"). In portrait the effect label is also set smaller and closer
# to the edge, so the longest one (44 characters) still fits one line of a 720 px frame.
# Run from the repository root once the tour's assets are staged:
#   bash examples/motion-design/effects-tour.sh --chapters-only
#   bash examples/motion-design/effects-reel.sh
# Needs ffmpeg (with libvpx-vp9, libopus, libwebp) and python3. Scratch output goes to build/effects-reel.
set -euo pipefail

LECLAP="node packages/leclap-cli/dist/index.js"
TOUR=examples/motion-design/effects-tour
ASSETS=build/effects-tour/assets
W=build/effects-reel
OUT=apps/leclap-web/public/videos/home
MUSIC=$ASSETS/musics/lofi-chill.mp3

# The bed: lofi-chill.mp3 (the tour's own) runs at 84 BPM with a downbeat at 0.54 s, so one beat is 5/7 s and
# seven bars are exactly 20 s. The reel takes bars 6-12 (17.683 s on, past the intro, full groove) and every
# cut falls on a beat of it: a moment is 2, 3 or 4 beats, 28 beats in all.
BED_START=17.683
BEATS=28
# 60 fps: the chapters render at it (step 1) and the reel keeps it. At 30 fps a moving line (the before/after
# divider) steps visibly on 60 and 120 Hz screens, however even each step is.
FPS=60
# Landing loudness: the films sit at -16 LUFS; the reel is ambient, so it sits 4 LU under them.
TARGET_LUFS=-20

# Moments: "chapter in-point beats  # why". In-points are seconds into the chapter render (they're identical in
# both orientations: the engine keeps the timeline). Order alternates photo / type / graphics and warm / cool,
# so no two neighbours share a look, and the last moment's whip flows into the first moment's push.
landscape=(
  "02-camera-graphics 0.45 2 # PUSH IN: neon alley, the camera already moving on frame one (also the poster)"
  "01-type 35.05 3 # GOLDEN HOUR: footage inside the letters, revealed from black on the downbeat"
  "05-compositing 0.30 3 # THREE SHORES: split panes, three shots in one frame, caption writing on"
  "01-type 9.15 2 # IMPACT: the punch-in lands on the beat, pink on plum, readable at any size"
  "05-compositing 16.85 3 # HALATION: the light primitive on bokeh, a warm full-frame glow"
  "02-camera-graphics 49.12 2 # BAR CHART: data bars growing from the first frame, the graphics layer"
  "04-captions 28.10 4 # POP CAPTIONS: SAME JSON. SAME FRAMES. EVERY TIME! word by word, out on the last word"
  "05-compositing 6.05 4 # BEFORE / AFTER: the whole 2.2 s wipe, from the laptop to the desk, then the after image"
  "02-camera-graphics 11.30 2 # ORBIT: the milky way turning, the one cool night shot"
  "03-transitions 20.15 3 # WHIP: a whip into a magenta gradient, mid-motion when it loops back to the alley"
)
# Portrait swaps two moments whose vertical layout doesn't hold: the bar chart overflows a 720 px frame (FRAMED,
# a tall traced frame, takes its place) and the whip's gradient goes yellow under its yellow label (a push onto
# the golden field instead). The before/after wipe takes the beat FRAMED gives back.
portrait=(
  "02-camera-graphics 0.45 2 # PUSH IN"
  "01-type 35.05 3 # GOLDEN HOUR"
  "05-compositing 0.30 3 # THREE SHORES"
  "01-type 9.15 2 # IMPACT"
  "05-compositing 16.85 3 # HALATION"
  "02-camera-graphics 32.35 2 # FRAMED: a frame tracing itself around the word, built for a tall screen"
  "04-captions 28.10 4 # POP CAPTIONS"
  "05-compositing 6.05 4 # BEFORE / AFTER"
  "02-camera-graphics 11.30 2 # ORBIT"
  "03-transitions 7.85 3 # PUSH: PUSH-LEFT pushes onto the golden field, PUSH-RIGHT lands on it"
)

[ -f "$MUSIC" ] || { echo "missing $MUSIC: run effects-tour.sh --chapters-only first (it stages the assets)" >&2; exit 1; }

# 1. The reel's chapters, per orientation: the tour's templates without the corner chapter label, a dark band
#    under the effect label of the split (white sky behind it), and in portrait the effect label at 22 px from
#    x 40 (the tour's is 32 px from x 64, sized for 1280 px).
for orientation in landscape portrait; do
  mkdir -p "$W/$orientation-$FPS" "$W/templates/$orientation"
  for chapter in 01-type 02-camera-graphics 03-transitions 04-captions 05-compositing; do
    [ -f "$W/$orientation-$FPS/$chapter.mp4" ] && continue
    python3 - "$TOUR/$chapter.json" "$W/templates/$orientation/$chapter.json" "$orientation" "$FPS" <<'PY'
import json, sys
template = json.load(open(sys.argv[1]))
template['global']['orientation'] = sys.argv[3]
template['global']['fps'] = int(sys.argv[4])
template['global'].pop('overlays', None)
if sys.argv[3] == 'portrait':
    for section in template['sections']:
        for line in section.get('kinetic', []):
            if line.get('font') == 'mono' and line.get('x') == 64 and line.get('y') == 40:
                line.update(size=22, x=40)
# The split's first pane is a white sky, and the light effect label above it disappears: a dark band behind the
# label, from the top edge, like the caption band the section already has at the bottom.
for section in template['sections']:
    if section.get('name') == 'split-horizontal':
        band = {'type': 'panel', 'at': 0, 'x': 0, 'y': 0, 'width': 1280, 'height': 110, 'color': '#141416@0.7', 'from': 'top'}
        section['graphics'] = [band, *section.get('graphics', [])]
json.dump(template, open(sys.argv[2], 'w'), indent=2)
PY
    echo "render $chapter ($orientation)"
    $LECLAP render "$W/templates/$orientation/$chapter.json" --assets "$ASSETS" --build "$W/build/$orientation-$FPS/$chapter" \
      --cache build/effects-tour/cache -q -o "$W/$orientation-$FPS/$chapter.mp4"
  done
done

# 2. The bed: 20 s of lofi-chill from a downbeat, a 10 ms fade at each end so the loop doesn't click, brought to
#    the landing's level with a measured linear gain (loudnorm's linear mode: the bed's dynamics don't change).
bed_seconds=$(python3 -c "print(f'{$BEATS * 60 / 84:.6f}')")
ffmpeg -hide_banner -loglevel error -y -ss "$BED_START" -t "$bed_seconds" -i "$MUSIC" \
  -af "afade=t=in:d=0.01,afade=t=out:st=$(python3 -c "print($bed_seconds - 0.01)"):d=0.01" -ar 48000 "$W/bed.wav"
measured=$(ffmpeg -hide_banner -i "$W/bed.wav" -af "loudnorm=I=$TARGET_LUFS:TP=-1.5:LRA=11:print_format=json" \
  -f null - 2>&1 | sed -n '/^{/,/^}/p')
read -r m_i m_tp m_lra m_thresh m_offset < <(python3 -c "
import json, sys; m = json.loads(sys.argv[1])
print(m['input_i'], m['input_tp'], m['input_lra'], m['input_thresh'], m['target_offset'])" "$measured")
ffmpeg -hide_banner -loglevel error -y -i "$W/bed.wav" -af \
  "loudnorm=I=$TARGET_LUFS:TP=-1.5:LRA=11:measured_I=$m_i:measured_TP=$m_tp:measured_LRA=$m_lra:measured_thresh=$m_thresh:offset=$m_offset:linear=true,aresample=48000" \
  "$W/bed-level.wav"

# 3. Cut, concatenate and encode one orientation.
#    $1 name, $2 chapter dir, $3 size, $4 H.264 crf, $5 VP9 crf, then the moments.
reel() {
  local name=$1 dir=$2 size=$3 crf=$4 vp9=$5
  shift 5
  local inputs=() graph="" chain="" index=0 beat=0
  for moment in "$@"; do
    read -r chapter at beats _ <<<"$moment"
    # Frame-exact: each moment ends on the frame nearest its last beat (a beat is FPS * 60 / 84 frames), so the cuts
    # never drift off the music.
    local from=$(((beat * FPS * 60 + 42) / 84)) to=$((((beat + beats) * FPS * 60 + 42) / 84))
    inputs+=(-ss "$at" -i "$dir/$chapter.mp4")
    graph+="[$index:v]fps=$FPS,trim=end_frame=$((to - from)),setpts=PTS-STARTPTS,scale=$size,setsar=1,format=yuv420p[m$index];"
    chain+="[m$index]"
    index=$((index + 1))
    beat=$((beat + beats))
  done
  [ "$beat" = "$BEATS" ] || { echo "$name: $beat beats, expected $BEATS" >&2; exit 1; }
  graph+="${chain}concat=n=$index:v=1:a=0,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[v]"
  ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -i "$W/bed-level.wav" -filter_complex "$graph" \
    -map "[v]" -map "$index:a" -c:v libx264 -profile:v high -preset slow -crf "$crf" -pix_fmt yuv420p \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
    -r "$FPS" -c:a aac -b:a 128k -shortest -movflags +faststart "$OUT/$name.mp4"
  ffmpeg -hide_banner -loglevel error -y -i "$OUT/$name.mp4" -c:v libvpx-vp9 -crf "$vp9" -b:v 0 -row-mt 1 \
    -deadline good -cpu-used 2 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
    -color_range tv -c:a libopus -b:a 96k "$OUT/$name.webm"
  # The poster is the reel's first frame, so nothing jumps when the video takes over from it.
  ffmpeg -hide_banner -loglevel error -y -i "$OUT/$name.mp4" -frames:v 1 -c:v libwebp -quality 80 "$OUT/$name.webp"
  ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$OUT/$name.mp4" | sed "s|^|$name.mp4 |"
}

reel effects-reel "$W/landscape-$FPS" 1280:720 23 36 "${landscape[@]}"
reel effects-reel-portrait "$W/portrait-$FPS" 720:1280 23 36 "${portrait[@]}"
