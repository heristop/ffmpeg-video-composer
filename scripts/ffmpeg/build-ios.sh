#!/usr/bin/env bash
# Cross-build FFmpeg + fftools for iOS (device arm64 + simulator arm64/x86_64), statically, with the
# SAME feature set as Android (drawtext via libfreetype+libharfbuzz, full filter graph, embedded
# ffmpeg/ffprobe programs → libfftools.a) so the on-device engine has parity. H.264 encoding uses
# Apple's h264_videotoolbox (no libopenh264 dep on iOS). Deps come from build-deps-ios.sh.
# Usage: build-ios.sh [slice ...]   (default: device sim-arm64 sim-x86_64). xcframeworks are only
# assembled when all three slices are present.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

IOS_OUT="$DIST_DIR/ios"
DEPS_DIR="$SCRIPT_DIR/deps/ios"
LIBS="libavcodec libavformat libavfilter libavutil libswscale libswresample libavdevice"

# iOS reuses FF_COMMON but drops libopenh264 (Android-only; iOS encodes via videotoolbox) and adds the
# h264_videotoolbox encoder/hwaccel. FF_COMMON is already --enable-static.
FF_IOS="${FF_COMMON//--enable-libopenh264/}"
FF_IOS="${FF_IOS//--enable-encoder=aac,mpeg4,libopenh264/--enable-encoder=aac,mpeg4,h264_videotoolbox}"

# Apply the source patches (entrypoint rename + re-entrancy + drawtext UTF-8 fix). Idempotent; the
# Android/host builds share this same .work checkout, but call it here too so an iOS-only build is
# self-contained.
fetch_ffmpeg
bash "$SCRIPT_DIR/patch-fftools.sh"

# slice → (sdk, arch, min-version flag)
slice_sdk() { case "$1" in device) echo iphoneos;; sim-arm64|sim-x86_64) echo iphonesimulator;; esac; }
slice_arch(){ case "$1" in device|sim-arm64) echo arm64;; sim-x86_64) echo x86_64;; esac; }
slice_min() { case "$1" in device) echo "-mios-version-min=$IOS_MIN";; *) echo "-mios-simulator-version-min=$IOS_MIN";; esac; }

build_slice() {
  local SLICE="$1" SDK ARCH MINFLAG SYSROOT CC PREFIX DEPS EXTRA=""
  SDK="$(slice_sdk "$SLICE")"; ARCH="$(slice_arch "$SLICE")"; MINFLAG="$(slice_min "$SLICE")"
  SYSROOT="$(xcrun --sdk "$SDK" --show-sdk-path)"
  CC="$(xcrun --sdk "$SDK" --find clang)"
  PREFIX="$IOS_OUT/slices/$SLICE"
  DEPS="$DEPS_DIR/$SLICE"
  [ -f "$DEPS/lib/pkgconfig/harfbuzz.pc" ] || { echo "missing iOS deps for $SLICE at $DEPS (run build-deps-ios.sh $SLICE)"; exit 1; }
  [ -f "$DEPS/lib/pkgconfig/fribidi.pc" ] || { echo "missing iOS libfribidi for $SLICE at $DEPS (run build-deps-ios.sh $SLICE)"; exit 1; }
  [ "$ARCH" = "x86_64" ] && EXTRA="--disable-x86asm"

  echo "[ffmpeg][ios:$SLICE] configure ($ARCH/$SDK) ..."
  ( cd "$SRC_DIR" && make distclean >/dev/null 2>&1 || true
    # configure must find freetype2/harfbuzz .pc (PKG_CONFIG_ALL_STATIC pulls their Libs.private).
    export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig"
    export PKG_CONFIG_ALL_STATIC=1
    ./configure \
      --prefix="$PREFIX" \
      --target-os=darwin --enable-cross-compile --arch="$ARCH" \
      --cc="$CC" --sysroot="$SYSROOT" \
      --pkg-config=pkg-config --pkg-config-flags=--static \
      $FF_IOS \
      --enable-videotoolbox --enable-hwaccel=h264_videotoolbox \
      --extra-cflags="-arch $ARCH $MINFLAG -isysroot $SYSROOT -fPIC -O2 -I$DEPS/include -I$DEPS/include/freetype2 -I$DEPS/include/harfbuzz" \
      --extra-ldflags="-arch $ARCH $MINFLAG -isysroot $SYSROOT -L$DEPS/lib" \
      $EXTRA
    # Build libs + fftools objects; the program link may fail (renamed main) — tolerated like host.
    make -j"$(sysctl -n hw.ncpu)" -k || true
    [ -f fftools/ffmpeg.o ] && [ -f fftools/ffprobe.o ] || { echo "[ffmpeg][ios:$SLICE] fftools objects missing"; exit 1; }
    make install-libs install-headers
    # fftools has subdirs (graph/, textformat/, resources/) — e.g. print_filtergraph lives in
    # graph/graphprint.o — so a flat fftools/*.o glob misses them. Archive every fftools object.
    ar rcs "$PREFIX/lib/libfftools.a" $(find fftools -name '*.o') )
  echo "[ffmpeg][ios:$SLICE] installed → $PREFIX (+ libfftools.a)"
}

SLICES=("$@")
[ ${#SLICES[@]} -eq 0 ] && SLICES=(device sim-arm64 sim-x86_64)
for slice in "${SLICES[@]}"; do build_slice "$slice"; done

# Assemble per-library xcframeworks only when all three slices exist.
if [ -d "$IOS_OUT/slices/device" ] && [ -d "$IOS_OUT/slices/sim-arm64" ] && [ -d "$IOS_OUT/slices/sim-x86_64" ]; then
  echo "[ffmpeg][ios] assembling xcframeworks ..."
  XCF_OUT="$IOS_OUT/xcframeworks"
  SIMFAT="$IOS_OUT/slices/sim-fat/lib"
  mkdir -p "$SIMFAT" "$XCF_OUT"
  for lib in $LIBS libfftools; do
    lipo -create \
      "$IOS_OUT/slices/sim-arm64/lib/$lib.a" \
      "$IOS_OUT/slices/sim-x86_64/lib/$lib.a" \
      -output "$SIMFAT/$lib.a"
    rm -rf "$XCF_OUT/$lib.xcframework"
    xcodebuild -create-xcframework \
      -library "$IOS_OUT/slices/device/lib/$lib.a" -headers "$IOS_OUT/slices/device/include" \
      -library "$SIMFAT/$lib.a" -headers "$IOS_OUT/slices/sim-arm64/include" \
      -output "$XCF_OUT/$lib.xcframework"
  done
  echo "[ffmpeg][ios] xcframeworks → $XCF_OUT"
else
  echo "[ffmpeg][ios] built slices: ${SLICES[*]} (skipping xcframework assembly — need all 3)"
fi
