#!/usr/bin/env bash
# Renders the LeClap effects tour: ten chapter templates under effects-tour/, then the assembly
# template effects-tour.json that strings them together with chapter cards.
# Run from the repository root after building the engine and the CLI:
#   pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
#   bash examples/motion-design/effects-tour.sh                    # every chapter, then the tour
#   bash examples/motion-design/effects-tour.sh 03 07              # only these chapters, then the tour
#   bash examples/motion-design/effects-tour.sh --chapters-only    # the chapters only (the showcase
#                                                                  # preview renders the tour itself)
# Needs ffmpeg and ffprobe on PATH. Scratch output goes to build/effects-tour (git-ignored); the
# delivery encode is build/effects-tour/effects-tour.mp4.
set -euo pipefail

LECLAP="node packages/leclap-cli/dist/index.js"
TOUR=examples/motion-design/effects-tour
W=build/effects-tour
A=$W/assets
LIB=packages/leclap-creative-kit/src/library
FONT=$LIB/fonts/Oswald.ttf
H264=(-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 30)

# 1. Stage the assets. The engine only reads real files under --assets (no symlinks out of it).
mkdir -p "$A/videos/effects-tour" "$A/luts" "$W/clips" "$W/chapters"
# The music chapter and the tour's bed use bundled tracks: they must be real files, not Git LFS pointers.
cp -r "$LIB/sfx" "$LIB/emoji" "$LIB/fonts" "$LIB/backgrounds" "$LIB/musics" "$A/"
# The opening's brand mark (DESIGN.md: the clapperboard, never recoloured).
mkdir -p "$A/pictures" && cp apps/leclap-web/public/pwa-512x512.png "$A/pictures/leclap-mark.png"

# 2. Synthetic footage: the bundled photographs set in motion, with a running clock so speed ramps
#    and freezes read on the clip itself, and lavfi audio (bundled clips and music are Git LFS objects).
clock="drawtext=fontfile=$FONT:text='%{eif\:t\:d}.%{eif\:mod(t*100\,100)\:d\:2}':fontsize=64:fontcolor=white:shadowcolor=black@0.5:shadowx=2:shadowy=3:x=w-tw-36:y=h-th-28"
pad="aevalsrc=0.08*sin(2*PI*220*t)+0.05*sin(2*PI*330*t):s=44100:d=8"
voice="aevalsrc=0.32*sin(2*PI*(150+40*sin(2*PI*1.3*t))*t)*(0.55+0.45*sin(2*PI*3.2*t))*gt(sin(2*PI*0.45*t)+0.6\,0)+0.06*sin(2*PI*48*t):s=44100:d=8"
push="zoompan=z='1+0.0012*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=640x360:fps=30"
clip() { # name photo filter [audio]
  [ -f "$W/clips/$1.mp4" ] && return
  ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 30 -i "$LIB/backgrounds/$2" -f lavfi -i "${4:-$pad}" \
    -vf "$3" "${H264[@]}" -c:a aac -b:a 96k -t 8 "$W/clips/$1.mp4"
}
clip portrait neon-alley.jpg "scale=-2:1280,crop=360:640:x='(iw-360)/2':y='(ih-640)*t/8'"
clip panorama desert-dunes.jpg "scale=1920:-2,crop=1920:540:0:'200+8*t'"
clip timer turquoise-sea.jpg "scale=800:-2,crop=640:360:x='20*t':y=40,$clock"
clip zoom autumn-leaves.jpg "scale=1280:-2,$push,$clock"
clip main cafe-table.jpg "scale=1280:-2,$push"
clip broll monstera-leaves.jpg "scale=800:-2,crop=640:360:x='160-20*t':y=40"
# The talking-head stand-in: a blurred, dimmed desk with the voice-like line's own waveform drawn over it.
[ -f "$W/clips/voice.mp4" ] || ffmpeg -hide_banner -loglevel error -y -loop 1 -framerate 30 \
  -i "$LIB/backgrounds/laptop-desk.jpg" -f lavfi -i "$voice" -filter_complex \
  "[0:v]scale=640:360,boxblur=10,eq=brightness=-0.18[bg];[1:a]asplit[a][w];[w]showwaves=s=640x140:mode=cline:rate=30:colors=white@0.85[wave];[bg][wave]overlay=0:200[v]" \
  -map "[v]" -map "[a]" "${H264[@]}" -c:a aac -b:a 96k -t 8 "$W/clips/voice.mp4"
cp "$W/clips/broll.mp4" "$A/videos/broll.mp4"
# A warm print look as a 9x9x9 .cube: lifted blacks, warm highlights, cooler shadows.
python3 - "$A/luts/warm-print.cube" <<'PY'
import sys
n = 9
rows = ['TITLE "Effects tour warm print"', f'LUT_3D_SIZE {n}']
for b in range(n):
    for g in range(n):
        for r in range(n):
            red, green, blue = (0.04 + v / (n - 1) * 0.94 for v in (r, g, b))
            rows.append(' '.join(f'{min(1, x):.5f}' for x in (red ** 0.92 * 1.02, green ** 0.98, blue ** 1.08 * 0.94)))
open(sys.argv[1], 'w').write('\n'.join(rows) + '\n')
PY

# Recorded scenes (project_video sections) of the footage and sound chapters.
footage=(--video fit-blur="$W/clips/portrait.mp4" --video fit-letterbox="$W/clips/portrait.mp4"
  --video fit-cover="$W/clips/panorama.mp4" --video focus-pan="$W/clips/panorama.mp4"
  --video clip-range="$W/clips/timer.mp4" --video ramp-hero="$W/clips/timer.mp4"
  --video ramp-montage="$W/clips/timer.mp4" --video ramp-bullet="$W/clips/timer.mp4"
  --video ramp-flash-in="$W/clips/timer.mp4" --video ramp-flash-out="$W/clips/timer.mp4"
  --video freeze="$W/clips/zoom.mp4" --video cutaway="$W/clips/main.mp4")
sound=(--video voice-clean="$W/clips/voice.mp4" --video voice-broadcast="$W/clips/voice.mp4"
  --video voice-warm="$W/clips/voice.mp4" --video voice-rumble-cut="$W/clips/voice.mp4"
  --video voice-room-gate="$W/clips/voice.mp4")
music=(--video music-duck="$W/clips/voice.mp4")
looks=(--video look-strength-full="$W/clips/panorama.mp4" --video look-strength-soft="$W/clips/panorama.mp4"
  --video grade-lut="$W/clips/zoom.mp4")

# 3. Render the chapters (each one is a standalone template; themes are one template per theme
#    because global.theme is template-wide).
chapters_only=0
chapters=()
for arg in "$@"; do
  case $arg in
    --chapters-only) chapters_only=1 ;;
    *) chapters+=("$arg") ;;
  esac
done
[ ${#chapters[@]} -eq 0 ] && chapters=(01 02 03 04 05 06 07 08 09 10)
for number in "${chapters[@]}"; do
  for template in "$TOUR/$number"-*.json; do
    name=$(basename "$template" .json)
    extra=()
    case $name in
      07-*) extra=("${looks[@]}") ;;
      08-*) extra=("${footage[@]}") ;;
      09-*) extra=("${sound[@]}") ;;
      10-*) extra=("${music[@]}") ;;
    esac
    echo "render $name"
    $LECLAP validate "$template" > "$W/chapters/$name.validate.log"
    $LECLAP render "$template" --assets "$A" --build "$W/build/$name" --cache "$W/cache" -q ${extra[@]+"${extra[@]}"} \
      -o "$W/chapters/$name.mp4"
    cp "$W/chapters/$name.mp4" "$A/videos/effects-tour/$name.mp4"
  done
done

# The opening's backdrop: a dimmed 3x3 wall of chapter moments, so the very first frame already shows
# what the tour is about instead of a bare card. Built from whichever chapter renders are staged.
wall=(02-camera-graphics:14 02-camera-graphics:6 05-compositing:0.3 07-looks:0.3 06-theme-e-neon:1.5 02-camera-graphics:2
  01-type:33.6 05-compositing:28.5 05-compositing:14.6)
wall_inputs=() wall_tiles="" wall_stack=""
for index in "${!wall[@]}"; do
  name=${wall[$index]%%:*}
  wall_inputs+=(-ss "${wall[$index]##*:}" -t 4 -i "$A/videos/effects-tour/$name.mp4")
  wall_tiles+="[$index:v]fps=30,scale=420:236,setsar=1,pad=426:240:3:2:color=0x141416[t$index];"
  wall_stack+="[t$index]"
done
ffmpeg -hide_banner -loglevel error -y "${wall_inputs[@]}" -filter_complex \
  "${wall_tiles}${wall_stack}xstack=inputs=9:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0|0_h0+h1|w0_h0+h1|w0+w1_h0+h1,pad=1280:720:1:0:color=0x141416,eq=brightness=-0.1:saturation=1.1,gblur=sigma=1,split[wall][band];[band]gblur=sigma=9,eq=brightness=-0.22:saturation=0.9[glass];[wall]format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='255*clip((abs(Y-360)-210)/110,0,1)'[sharp];[glass][sharp]overlay=0:0,format=yuv420p,vignette=PI/4[v]" \
  -map "[v]" -an "${H264[@]}" -t 4 "$A/videos/effects-tour/opening-wall.mp4"

# 4. Assemble the tour from the chapter renders, then the delivery encode (the CLI encodes at the
#    ultrafast preset).
[ "$chapters_only" = 1 ] && exit 0
$LECLAP validate examples/motion-design/effects-tour.json
$LECLAP render examples/motion-design/effects-tour.json --assets "$A" --build "$W/build/tour" --cache "$W/cache" -q \
  -o "$W/effects-tour.raw.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$W/effects-tour.raw.mp4" \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 160k -shortest -movflags +faststart "$W/effects-tour.mp4"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$W/effects-tour.mp4"
