#!/usr/bin/env bash
# Regenerates the FFmpeg 9 PR media with the LeClap CLI. Run from the repository root after building:
#   pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
#   FFMPEG9=/path/to/ffmpeg-9/bin FFMPEG8=/path/to/ffmpeg-8/bin bash .github/pr-media/ffmpeg-9/make-media.sh
# FFMPEG9 and FFMPEG8 are directories holding `ffmpeg` and `ffprobe`. Stills and labels are encoded with
# $FFMPEG8/ffmpeg (needs libwebp and drawtext). Scratch output goes to build/pr/ffmpeg-9 (git-ignored).
set -euo pipefail

: "${FFMPEG9:?set FFMPEG9 to the directory of an FFmpeg 9 ffmpeg/ffprobe}"
: "${FFMPEG8:?set FFMPEG8 to the directory of an FFmpeg 8 ffmpeg/ffprobe}"
NODE=${NODE:-node}
ROOT=$(pwd)
MEDIA=$ROOT/.github/pr-media/ffmpeg-9
LIB=$ROOT/packages/leclap-creative-kit/src/library
W=$ROOT/build/pr/ffmpeg-9
TOOL=$FFMPEG8/ffmpeg
FONT=$LIB/fonts/RobotoMono.ttf
rm -rf "$W" && mkdir -p "$W"

# A pass-through `ffmpeg` that records the option files the engine hands to FFmpeg, then runs $REAL_FFMPEG.
mkdir -p "$W/wrap"
cat > "$W/wrap/ffmpeg" << 'EOF'
#!/usr/bin/env bash
prev=""
for a in "$@"; do
  case "$prev" in
    -/* | -filter_script* | -filter_complex_script) printf '%s %s (%s bytes)\n' "$prev" "${a##*/}" "$(wc -c < "$a" | xargs)" >> "$FFLOG" ;;
  esac
  prev="$a"
done
exec "$REAL_FFMPEG" "$@"
EOF
chmod +x "$W/wrap/ffmpeg"

# render <ffmpeg path> <template> <out.mp4> <option-file log> [ffprobe path]
render() {
  local bin=$1 template=$2 out=$3 log=$4 probe=${5:-${1%/*}/ffprobe} dir
  dir=$(mktemp -d "$W/run.XXXX")
  ln -s "$probe" "$dir/ffprobe"
  ln -s "$W/wrap/ffmpeg" "$dir/ffmpeg"
  : > "$log"
  FFLOG=$log REAL_FFMPEG=$bin PATH=$dir:$PATH \
    "$NODE" packages/leclap-cli/dist/index.js render "$template" --assets "$LIB" --build "$dir/build" -o "$out" -q
}

frames() { "$FFMPEG9/ffprobe" -v error -count_frames -show_entries stream=codec_type,nb_read_frames,duration -of csv=p=0 "$1" | paste -sd' ' -; }

# 1. The pre-fix option forms against FFmpeg 9.
FFMPEG=$FFMPEG9/ffmpeg bash "$MEDIA/filter-script-repro.sh" > "$MEDIA/filter-script-ffmpeg9.txt" 2>&1

# 2. The long-graph template on FFmpeg 9 and 8, then the contact sheet, the excerpt and the parity still.
render "$FFMPEG9/ffmpeg" "$MEDIA/long-graph.json" "$W/long-graph-9.mp4" "$W/option-files-9.log"
render "$FFMPEG8/ffmpeg" "$MEDIA/long-graph.json" "$W/long-graph-8.mp4" "$W/option-files-8.log"
# ffmpeg-static (FFmpeg 6.0) keeps the script option; it ships no ffprobe, so FFmpeg 8's is used.
FFMPEG6=$(cd packages/ffmpeg-video-composer && "$NODE" -p "require('ffmpeg-static')")
render "$FFMPEG6" "$MEDIA/long-graph.json" "$W/long-graph-6.mp4" "$W/option-files-6.log" "$FFMPEG8/ffprobe"
cp "$W/long-graph-9.mp4" "$MEDIA/long-graph-ffmpeg9.mp4"
"$TOOL" -hide_banner -loglevel error -y -i "$W/long-graph-9.mp4" \
  -vf "select='not(mod(n\,10))',scale=316:-2,tile=4x3:padding=4:color=black" \
  -frames:v 1 -c:v libwebp -quality 35 -compression_level 6 "$MEDIA/long-graph-ffmpeg9-sheet.webp"

printf 'FFmpeg %s' "$("$FFMPEG8/ffmpeg" -version | awk 'NR==1{print $3}')" > "$W/l8.txt"
printf 'FFmpeg %s' "$("$FFMPEG9/ffmpeg" -version | awk 'NR==1{print $3}')" > "$W/l9.txt"
"$FFMPEG9/ffmpeg" -hide_banner -i "$W/long-graph-8.mp4" -i "$W/long-graph-9.mp4" -lavfi '[0:v][1:v]psnr' -f null - 2>&1 |
  grep -o 'PSNR y:.*' > "$W/psnr.txt"
printf 't = 1.5 s, same template: %s' "$(cut -d' ' -f5 "$W/psnr.txt" | sed 's/average:/PSNR /')" > "$W/lc.txt"
cat > "$W/parity.fg" << EOF
[0:v]scale=636:-2,drawbox=x=0:y=0:w=iw:h=44:color=black@0.65:t=fill,drawtext=fontfile=$FONT:textfile=$W/l8.txt:x=16:y=12:fontsize=22:fontcolor=white[a];
[1:v]scale=636:-2,drawbox=x=0:y=0:w=iw:h=44:color=black@0.65:t=fill,drawtext=fontfile=$FONT:textfile=$W/l9.txt:x=16:y=12:fontsize=22:fontcolor=white[b];
[a][b]hstack,pad=w=1280:h=ih+56:x=4:y=0:color=black,drawtext=fontfile=$FONT:textfile=$W/lc.txt:x=(w-tw)/2:y=h-38:fontsize=20:fontcolor=white
EOF
"$TOOL" -hide_banner -loglevel error -y -ss 1.5 -i "$W/long-graph-8.mp4" -ss 1.5 -i "$W/long-graph-9.mp4" \
  -/filter_complex "$W/parity.fg" -frames:v 1 -c:v libwebp -quality 50 -compression_level 6 "$MEDIA/parity-8-vs-9.webp"

{
  echo "# long-graph.json, option files the engine passed to FFmpeg"
  echo "FFmpeg 9: $(cat "$W/option-files-9.log")"
  echo "FFmpeg 8: $(cat "$W/option-files-8.log")"
  echo "FFmpeg 6 (ffmpeg-static): $(cat "$W/option-files-6.log")"
  echo
  echo "# frames (codec, duration, decoded frames)"
  echo "FFmpeg 9: $(frames "$W/long-graph-9.mp4")"
  echo "FFmpeg 8: $(frames "$W/long-graph-8.mp4")"
  echo
  echo "# ffmpeg -i long-graph-8.mp4 -i long-graph-9.mp4 -lavfi '[0:v][1:v]psnr' -f null -"
  cat "$W/psnr.txt"
  echo
  echo "# decoded-frame MD5 (-map 0:v -f md5)"
  echo "FFmpeg 9: $("$FFMPEG9/ffmpeg" -v error -i "$W/long-graph-9.mp4" -map 0:v -f md5 -)"
  echo "FFmpeg 8: $("$FFMPEG9/ffmpeg" -v error -i "$W/long-graph-8.mp4" -map 0:v -f md5 -)"
} > "$MEDIA/long-graph-parity.txt"

# 3. The music pass over cut-only sections: FFmpeg 8, FFmpeg 9 with the fix, FFmpeg 9 with the pre-fix fold.
#    The pre-fix engine is a scratch copy of the built dist with the FFmpeg 9 branch turned off.
mkdir -p "$W/prefix"
cp packages/ffmpeg-video-composer/package.json "$W/prefix/"
cp -R packages/ffmpeg-video-composer/dist "$W/prefix/dist"
ln -s "$ROOT/packages/ffmpeg-video-composer/node_modules" "$W/prefix/node_modules"
perl -pi -e 's/shortestKeepsConcatVideo: !\(ffmpegAtLeast\(version, 9, 0\) \|\| isSnapshot\(version\)\)/shortestKeepsConcatVideo: true/' "$W"/prefix/dist/encoding-*.js
cat > "$W/prefix/render.mjs" << 'EOF'
import fs from 'node:fs/promises';
import { compile } from './dist/index.js';
const [templatePath, buildDir, assetsDir, out] = process.argv.slice(2);
const template = JSON.parse(await fs.readFile(templatePath, 'utf8'));
const result = await compile({ buildDir, assetsDir, fields: {}, deterministic: true }, template, {});
await fs.copyFile(result, out);
EOF
render "$FFMPEG8/ffmpeg" "$MEDIA/music-cuts.json" "$W/music-8.mp4" "$W/unused.log"
render "$FFMPEG9/ffmpeg" "$MEDIA/music-cuts.json" "$W/music-9-fixed.mp4" "$W/unused.log"
PATH=$FFMPEG9:$PATH "$NODE" "$W/prefix/render.mjs" "$MEDIA/music-cuts.json" "$W/prefix-build" "$LIB" "$W/music-9-prefix.mp4" > "$W/prefix.log" 2>&1

# The same mix on one assembled file, assembled by each release (what the fixed path does).
MUS=$LIB/musics/chill-hip-hop.mp3
printf "file '%s'\n" "$W/prefix-build/one_output.mp4" "$W/prefix-build/two_output.mp4" > "$W/seg.list"
MIX=(-filter_complex '[1:a]atrim=duration=4[m];[0:a][m]amix=inputs=2:duration=first[a]' -map 0:v -map '[a]' -c:v copy -c:a aac)
for v in 8 9; do
  bin=FFMPEG$v
  "${!bin}/ffmpeg" -v error -y -f concat -safe 0 -i "$W/seg.list" -c copy "$W/concat-$v.mp4"
done
"$FFMPEG9/ffmpeg" -v error -y -i "$W/concat-9.mp4" -i "$MUS" "${MIX[@]}" -shortest "$W/mix-9of9.mp4"
"$FFMPEG9/ffmpeg" -v error -y -i "$W/concat-8.mp4" -i "$MUS" "${MIX[@]}" -shortest "$W/mix-9of8.mp4"
"$FFMPEG9/ffmpeg" -v error -y -i "$W/concat-9.mp4" -i "$MUS" "${MIX[@]}" -t 4 "$W/mix-9of9-t.mp4"
{
  echo "# music-cuts.json: two cut-only 2 s sections at 30 fps (plan: 120 frames, 4.0 s) under a music track"
  echo "# stream, duration (s), decoded frames"
  echo "FFmpeg 8 leclap render:                          $(frames "$W/music-8.mp4")"
  echo "FFmpeg 9 leclap render, pre-fix (folded concat): $(frames "$W/music-9-prefix.mp4")"
  echo "FFmpeg 9 leclap render, this PR (assembled file): $(frames "$W/music-9-fixed.mp4")"
  echo
  echo "# isolation, FFmpeg 9 music mix with -c:v copy over one assembled file"
  echo "file assembled by FFmpeg 9, -shortest: $(frames "$W/mix-9of9.mp4")"
  echo "file assembled by FFmpeg 8, -shortest: $(frames "$W/mix-9of8.mp4")"
  echo "file assembled by FFmpeg 9, -t 4:      $(frames "$W/mix-9of9-t.mp4")"
} > "$MEDIA/music-pass.txt"

# 4. The engine's `-filters` parser before and after, on each release.
"$NODE" "$MEDIA/filters-parse.mjs" "FFmpeg 9=$FFMPEG9/ffmpeg" "FFmpeg 8=$FFMPEG8/ffmpeg" "FFmpeg 6 (ffmpeg-static)=$FFMPEG6" > "$MEDIA/filters-parser.txt"
