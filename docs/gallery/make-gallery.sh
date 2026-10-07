#!/usr/bin/env bash
# Regenerates the documentation gallery (docs/media/gallery/*.webp) with the LeClap CLI.
# Run from the repository root after building the engine and the CLI:
#   pnpm --filter ffmpeg-video-composer build && pnpm --filter @leclap/cli build
#   bash docs/gallery/make-gallery.sh [sheet ...]
# Needs ffmpeg (with libwebp) and python3 on PATH. Scratch output goes to build/gallery (git-ignored).
set -euo pipefail

LIB=packages/leclap-creative-kit/src/library
A=build/gallery/assets

# The engine only reads real files under --assets (no symlinks out of it), so stage copies of the
# bundled fonts, emoji and photos. The footage clips are generated from the photos by gallery.py.
mkdir -p "$A"
cp -r "$LIB/fonts" "$LIB/emoji" "$LIB/backgrounds" "$A/"

for template in docs/gallery/templates/*.json docs/gallery/templates/*/*.json; do
  node packages/leclap-cli/dist/index.js validate "$template" > /dev/null
done

python3 docs/gallery/gallery.py "$@"
