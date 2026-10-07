#!/usr/bin/env bash
# Build FFmpeg + fftools statically for the HOST (macOS) so the engine crate can link and run on the
# desktop — used for `cargo test` (real run/probe execution + re-entrancy) and uniffi binding
# generation. Mirrors build-android.sh minus the NDK cross-compile + mediacodec. Host libfreetype,
# libharfbuzz and libfribidi are resolved from the system pkg-config (`brew install freetype harfbuzz
# fribidi`). Output: scripts/ffmpeg/dist/host/{lib,include}.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

PREFIX="$DIST_DIR/host"

fetch_ffmpeg
bash "$SCRIPT_DIR/patch-fftools.sh"

echo "[ffmpeg][host] configure ..."
( cd "$SRC_DIR" && make distclean >/dev/null 2>&1 || true
  ./configure --prefix="$PREFIX" $FF_COMMON --extra-cflags="-O2 -fPIC"
  # Compile libs + fftools objects; the executable link fails (no `main`) — tolerated.
  make -j"$(sysctl -n hw.ncpu)" -k || true
  [ -f fftools/ffmpeg.o ] && [ -f fftools/ffprobe.o ] || { echo "[ffmpeg][host] fftools objects missing"; exit 1; }
  make install-libs install-headers
  # FFmpeg 8.0 split fftools into subdirs (graph/, textformat/, resources/), so a flat fftools/*.o
  # glob drops graph/graphprint.o (print_filtergraphs) and the textformat/resources objects it pulls.
  # Archive every object, matching build-android.sh / build-ios.sh.
  ar rcs "$PREFIX/lib/libfftools.a" $(find fftools -name '*.o')
)
echo "[ffmpeg][host] installed → $PREFIX (+ libfftools.a)"
