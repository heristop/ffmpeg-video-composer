#!/usr/bin/env bash
# Cross-build FFmpeg shared libraries for Android via the NDK clang toolchain.
# Usage: build-android.sh [abi ...]   (default: all ABIs from versions.env)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

NDK="${ANDROID_NDK_HOME:-$HOME/Library/Android/sdk/ndk/$NDK_VERSION}"
[ -d "$NDK" ] || { echo "NDK not found at $NDK"; exit 1; }
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/darwin-x86_64"

abi_to_triple() {
  case "$1" in
    arm64-v8a)   echo "aarch64-linux-android" ;;
    armeabi-v7a) echo "armv7a-linux-androideabi" ;;
    x86_64)      echo "x86_64-linux-android" ;;
    *) echo "unknown abi $1" >&2; exit 1 ;;
  esac
}
abi_to_arch() {
  case "$1" in
    arm64-v8a) echo "aarch64" ;;
    armeabi-v7a) echo "arm" ;;
    x86_64) echo "x86_64" ;;
  esac
}

build_abi() {
  local ABI="$1"
  local TRIPLE ARCH CC PREFIX
  TRIPLE="$(abi_to_triple "$ABI")"
  ARCH="$(abi_to_arch "$ABI")"
  # armv7a uses a different clang prefix for the cross-prefix tools (arm-linux-androideabi-).
  local TOOLPREFIX="$TRIPLE"
  [ "$ABI" = "armeabi-v7a" ] && TOOLPREFIX="arm-linux-androideabi"
  CC="$TOOLCHAIN/bin/${TRIPLE}${ANDROID_API}-clang"
  PREFIX="$DIST_DIR/android/$ABI"

  # x86_64 SIMD needs nasm (absent here) → disable x86 asm only for that ABI.
  local EXTRA=""
  [ "$ABI" = "x86_64" ] && EXTRA="--disable-x86asm"

  # libfreetype (drawtext) is cross-built by build-deps.sh into deps/android/<abi>. Point FFmpeg's
  # configure at its pkg-config so --enable-libfreetype resolves; static link via Libs.private.
  local FT_PREFIX="$SCRIPT_DIR/deps/android/$ABI"
  [ -f "$FT_PREFIX/lib/pkgconfig/freetype2.pc" ] || {
    echo "[ffmpeg][$ABI] missing libfreetype — run scripts/ffmpeg/build-deps.sh $ABI first"; exit 1; }
  # --enable-libfribidi (FF_COMMON) resolves fribidi.pc from the same prefix; a deps tree built before
  # fribidi was added fails configure with "fribidi not found" — rebuild the deps instead.
  [ -f "$FT_PREFIX/lib/pkgconfig/fribidi.pc" ] || {
    echo "[ffmpeg][$ABI] missing libfribidi — run scripts/ffmpeg/build-deps.sh $ABI first"; exit 1; }
  export PKG_CONFIG_PATH="$FT_PREFIX/lib/pkgconfig"

  # Rename the fftools `main` → ffmpeg_main/ffprobe_main (+ re-entrancy reset) so the CLI can be
  # embedded into the engine .so. Done once on the shared source tree (idempotent).
  bash "$SCRIPT_DIR/patch-fftools.sh"

  echo "[ffmpeg][$ABI] configure ..."
  ( cd "$SRC_DIR" && make distclean >/dev/null 2>&1 || true
    ./configure \
      --prefix="$PREFIX" \
      --target-os=android --enable-cross-compile \
      --arch="$ARCH" --sysroot="$TOOLCHAIN/sysroot" \
      --cc="$CC" --cxx="${CC}++" \
      --ar="$TOOLCHAIN/bin/llvm-ar" --nm="$TOOLCHAIN/bin/llvm-nm" \
      --ranlib="$TOOLCHAIN/bin/llvm-ranlib" --strip="$TOOLCHAIN/bin/llvm-strip" \
      --pkg-config=pkg-config --pkg-config-flags=--static \
      $FF_COMMON \
      --enable-mediacodec --enable-jni --enable-encoder=h264_mediacodec --enable-hwaccel=h264_mediacodec \
      --extra-cflags="-O2 -fPIC -DANDROID -D__ANDROID_API__=$ANDROID_API -I$FT_PREFIX/include/freetype2" \
      --extra-ldflags="-Wl,-soname,libavcodec.so -L$FT_PREFIX/lib" \
      $EXTRA
    # Compile libs + fftools objects. The final `ffmpeg`/`ffprobe` executable link fails (we removed
    # `main`) — tolerated: we only need the libs and the fftools .o files, which are built first.
    make -j"$(sysctl -n hw.ncpu)" -k || true
    [ -f fftools/ffmpeg.o ] && [ -f fftools/ffprobe.o ] || { echo "[ffmpeg][$ABI] fftools objects missing"; exit 1; }
    make install-libs install-headers
    # Archive ALL fftools objects (incl. the textformat/ + graph/ subdirs new in n8.0) for the engine.
    "$TOOLCHAIN/bin/llvm-ar" rcs "$PREFIX/lib/libfftools.a" $(find fftools -name '*.o')
  )
  echo "[ffmpeg][$ABI] installed → $PREFIX (+ libfftools.a)"
}

fetch_ffmpeg
ABIS=("$@")
[ ${#ABIS[@]} -eq 0 ] && read -ra ABIS <<< "$ANDROID_ABIS"
for abi in "${ABIS[@]}"; do build_abi "$abi"; done
echo "[ffmpeg] android build complete: ${ABIS[*]}"
