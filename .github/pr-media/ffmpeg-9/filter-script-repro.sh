#!/usr/bin/env bash
# Runs the option-file forms the engine used before this PR (-filter_script:v, -filter_complex_script)
# and the ones it uses now on FFmpeg 7.0+ (-/vf, -/filter_complex). FFMPEG picks the binary.
F=${FFMPEG:-ffmpeg}
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
cd "$T" || exit 1
echo "drawbox=x=10:y=10:w=50:h=50:color=red@0.8:t=fill" > g.txt
echo "[0:v]drawbox=x=10:y=10:w=50:h=50:color=red:t=fill[v]" > gc.txt
"$F" -hide_banner -version | head -1
echo
run() {
  echo "\$ ffmpeg -f lavfi -i testsrc2=s=320x180:d=1 $* -frames:v 1 -f null -"
  "$F" -hide_banner -loglevel error -f lavfi -i testsrc2=s=320x180:d=1 "$@" -frames:v 1 -f null - 2>&1
  echo "exit status $?"
  echo
}
echo "# before this PR (script options, FFmpeg 6 to 8)"
run -filter_script:v g.txt
run -filter_complex_script gc.txt -map '[v]'
echo "# this PR on FFmpeg 7.0+ (-/option file)"
run -/vf g.txt
run -/filter_complex gc.txt -map '[v]'
