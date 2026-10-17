# Regenerates the masks-batch PR media. Run from the repo root with mise's FFmpeg (drawtext + libwebp) on PATH
# and the CLI built from this branch (pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build).
#   ASSETS=<creative-kit library with real footage> bash .github/pr-media/masks-batch/make-media.sh
set -euo pipefail
MEDIA=.github/pr-media/masks-batch
ASSETS=${ASSETS:-packages/leclap-creative-kit/src/library}
BUILD=${BUILD:-build/pr/masks-batch}
mkdir -p "$BUILD"
(cd examples/motion-design && node ../../packages/leclap-cli/dist/index.js render fx-masks.json \
  -o "../../$MEDIA/leclap-masks-batch-evidence.mp4" --assets "$ASSETS" --build "../../$BUILD" --qc)
V="$MEDIA/leclap-masks-batch-evidence.mp4"
# Contact sheet of the whole clip, then one still per effect.
ffmpeg -v error -y -i "$V" -vf fps=2,scale=320:-2,tile=6x4 -frames:v 1 -c:v libwebp -quality 82 "$MEDIA/contact-sheet.webp"
# One frame per effect (clip rise, bands, circle iris, star iris, zoom-through).
ffmpeg -v error -y -i "$V" -vf "fps=2,select='eq(n,1)+eq(n,5)+eq(n,9)+eq(n,13)+eq(n,16)',scale=480:-2,tile=5x1" \
  -frames:v 1 -vsync 0 -c:v libwebp -quality 82 "$MEDIA/effects.webp"
