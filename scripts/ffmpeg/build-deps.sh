#!/usr/bin/env bash
# Cross-build the FFmpeg external deps (static) for Android: libfreetype + libharfbuzz + libfribidi
# (drawtext), libopenh264 (encoder) and libvpx (VP9-alpha decoder).
# Output: scripts/ffmpeg/deps/android/<abi>/{lib,include} with a pkg-config file freetype2.pc that
# build-android.sh points FFmpeg's configure at (via PKG_CONFIG_PATH). Usage: build-deps.sh [abi ...]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

NDK="${ANDROID_NDK_HOME:-$HOME/Library/Android/sdk/ndk/$NDK_VERSION}"
[ -d "$NDK" ] || { echo "NDK not found at $NDK"; exit 1; }
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/darwin-x86_64"
DEPS_DIR="$SCRIPT_DIR/deps"
# FREETYPE_VERSION (from versions.env) is a git tag like VER-2-13-3 → release tarball 2.13.3.
FT_DOTTED="$(echo "$FREETYPE_VERSION" | sed 's/^VER-//; s/-/./g')"
FT_SRC="$WORK_DIR/freetype-$FT_DOTTED"

abi_to_triple() {
  case "$1" in
    arm64-v8a)   echo "aarch64-linux-android" ;;
    armeabi-v7a) echo "armv7a-linux-androideabi" ;;
    x86_64)      echo "x86_64-linux-android" ;;
    *) echo "unknown abi $1" >&2; exit 1 ;;
  esac
}
# autotools --host triple (armv7 uses arm-linux-androideabi).
abi_to_host() {
  case "$1" in
    arm64-v8a)   echo "aarch64-linux-android" ;;
    armeabi-v7a) echo "arm-linux-androideabi" ;;
    x86_64)      echo "x86_64-linux-android" ;;
  esac
}

OH264_SRC="$WORK_DIR/openh264"
HB_SRC="$WORK_DIR/harfbuzz-$HARFBUZZ_VERSION"
LIBVPX_SRC="$WORK_DIR/libvpx-$LIBVPX_VERSION"
FRIBIDI_SRC="$WORK_DIR/fribidi-$FRIBIDI_VERSION"

fetch_freetype() {
  mkdir -p "$WORK_DIR"
  if [ ! -f "$FT_SRC/configure" ]; then
    echo "[freetype] fetching $FT_DOTTED ..."
    curl -fsSL "https://download.savannah.gnu.org/releases/freetype/freetype-$FT_DOTTED.tar.gz" \
      | tar -xz -C "$WORK_DIR"
  else
    echo "[freetype] source present at $FT_SRC"
  fi
}

fetch_openh264() {
  if [ ! -f "$OH264_SRC/Makefile" ]; then
    echo "[openh264] cloning v$OPENH264_VERSION ..."
    git clone --depth 1 --branch "v$OPENH264_VERSION" https://github.com/cisco/openh264.git "$OH264_SRC"
  else
    echo "[openh264] source present at $OH264_SRC"
  fi
}

fetch_harfbuzz() {
  if [ ! -f "$HB_SRC/CMakeLists.txt" ]; then
    echo "[harfbuzz] fetching $HARFBUZZ_VERSION ..."
    curl -fsSL "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ_VERSION/harfbuzz-$HARFBUZZ_VERSION.tar.xz" \
      | tar -xJ -C "$WORK_DIR"
  else
    echo "[harfbuzz] source present at $HB_SRC"
  fi
}

fetch_libvpx() {
  if [ ! -f "$LIBVPX_SRC/configure" ]; then
    echo "[libvpx] cloning v$LIBVPX_VERSION ..."
    git clone --depth 1 --branch "v$LIBVPX_VERSION" https://chromium.googlesource.com/webm/libvpx "$LIBVPX_SRC"
  else
    echo "[libvpx] source present at $LIBVPX_SRC"
  fi
}

# The release tarball ships a ready autotools `configure` and pre-generated Unicode tables (lib/*.tab.i),
# so the cross-build needs no host generator run — the same recipe as freetype.
fetch_fribidi() {
  if [ ! -f "$FRIBIDI_SRC/configure" ]; then
    echo "[fribidi] fetching $FRIBIDI_VERSION ..."
    curl -fsSL "https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI_VERSION/fribidi-$FRIBIDI_VERSION.tar.xz" \
      | tar -xJ -C "$WORK_DIR"
  else
    echo "[fribidi] source present at $FRIBIDI_SRC"
  fi
}

# Cross-build libfribidi (static, pure C, LGPL-2.1) — enables drawtext's `text_shaping` (bidi reordering of
# Arabic/Hebrew lines; HarfBuzz does the glyph shaping). Only the library is built (`make -C lib`: no
# bin/doc/test, so no c2man or host-run tests); fribidi.pc lands in the shared per-abi prefix that
# build-android.sh already has on PKG_CONFIG_PATH, and its Cflags carry -DFRIBIDI_LIB_STATIC.
build_fribidi_abi() {
  local ABI="$1" TRIPLE HOST CC PREFIX
  TRIPLE="$(abi_to_triple "$ABI")"
  HOST="$(abi_to_host "$ABI")"
  CC="$TOOLCHAIN/bin/${TRIPLE}${ANDROID_API}-clang"
  PREFIX="$DEPS_DIR/android/$ABI"
  echo "[fribidi][$ABI] configure ..."
  ( cd "$FRIBIDI_SRC" && make distclean >/dev/null 2>&1 || true
    ./configure \
      --host="$HOST" --prefix="$PREFIX" \
      --enable-static --disable-shared --with-pic --disable-debug --disable-deprecated \
      CC="$CC" \
      AR="$TOOLCHAIN/bin/llvm-ar" RANLIB="$TOOLCHAIN/bin/llvm-ranlib" \
      CFLAGS="-O2 -fPIC -DANDROID -D__ANDROID_API__=$ANDROID_API"
    make -j"$(sysctl -n hw.ncpu)" -C lib
    make -C lib install
    make install-pkgconfigDATA ) || { echo "[fribidi][$ABI] BUILD FAILED"; exit 1; }
  [ -f "$PREFIX/lib/libfribidi.a" ] || { echo "[fribidi][$ABI] libfribidi.a not installed"; exit 1; }
  echo "[fribidi][$ABI] installed → $PREFIX"
}

# Cross-build libharfbuzz (static, WITH freetype) — drawtext in FFmpeg 8.0 needs both. Uses the NDK's
# CMake toolchain file; freetype (built above) is supplied explicitly so hb-ft.cc compiles + links.
build_harfbuzz_abi() {
  local ABI="$1" PREFIX BUILD
  PREFIX="$DEPS_DIR/android/$ABI"
  BUILD="$HB_SRC/build-$ABI"
  echo "[harfbuzz][$ABI] cmake configure ..."
  rm -rf "$BUILD"
  cmake -G Ninja -S "$HB_SRC" -B "$BUILD" \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$ABI" -DANDROID_PLATFORM="android-$ANDROID_API" \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DHB_HAVE_FREETYPE=ON -DHB_HAVE_GLIB=OFF -DHB_HAVE_ICU=OFF \
    -DHB_HAVE_GRAPHITE2=OFF -DHB_BUILD_TESTS=OFF -DHB_BUILD_UTILS=OFF \
    -DCMAKE_PREFIX_PATH="$PREFIX" \
    -DFREETYPE_LIBRARY="$PREFIX/lib/libfreetype.a" \
    -DFREETYPE_INCLUDE_DIR_ft2build="$PREFIX/include/freetype2" \
    -DFREETYPE_INCLUDE_DIR_freetype2="$PREFIX/include/freetype2" \
    >/dev/null || { echo "[harfbuzz][$ABI] CONFIGURE FAILED"; exit 1; }
  # Build all targets (core + subset); `cmake --install` references libharfbuzz-subset.a even though
  # drawtext only needs core harfbuzz, so building just the `harfbuzz` target makes install fail.
  cmake --build "$BUILD" || { echo "[harfbuzz][$ABI] BUILD FAILED"; exit 1; }
  cmake --install "$BUILD" >/dev/null || { echo "[harfbuzz][$ABI] INSTALL FAILED"; exit 1; }
  [ -f "$PREFIX/lib/libharfbuzz.a" ] || { echo "[harfbuzz][$ABI] libharfbuzz.a not installed"; exit 1; }
  # CMake doesn't emit a .pc — write the one FFmpeg's configure needs. FFmpeg includes <hb.h>/<hb-ft.h>
  # (headers under include/harfbuzz), and the link pulls libc++ (+ -lm); freetype2 via Requires.private.
  mkdir -p "$PREFIX/lib/pkgconfig"
  cat > "$PREFIX/lib/pkgconfig/harfbuzz.pc" <<EOF
prefix=$PREFIX
libdir=\${prefix}/lib
includedir=\${prefix}/include
Name: harfbuzz
Description: HarfBuzz text shaping library
Version: $HARFBUZZ_VERSION
Requires.private: freetype2
Libs: -L\${libdir} -lharfbuzz -lc++_shared -lm
Cflags: -I\${includedir}/harfbuzz
EOF
  echo "[harfbuzz][$ABI] installed → $PREFIX"
}

# openh264 ARCH name for its Makefile.
abi_to_oh264_arch() {
  case "$1" in
    arm64-v8a)   echo "arm64" ;;
    armeabi-v7a) echo "arm" ;;
    x86_64)      echo "x86_64" ;;
  esac
}

build_openh264_abi() {
  local ABI="$1" PREFIX OARCH
  PREFIX="$DEPS_DIR/android/$ABI"
  OARCH="$(abi_to_oh264_arch "$ABI")"
  echo "[openh264][$ABI] build (ARCH=$OARCH) ..."
  # x86_64 SIMD needs nasm (absent here, like the FFmpeg build) → disable openh264's asm for it.
  local ASM=""
  [ "$ABI" = "x86_64" ] && ASM="USE_ASM=No"
  # openh264's android Makefile needs TARGET=android-<api> (not NDKLEVEL). `make clean` leaves some
  # arch-specific objects (e.g. cpu-features.o) behind, so a prior ABI's objects get archived into the
  # next ABI's lib ("incompatible with armelf_linux_eabi"). `git clean -fdx` wipes the tree between ABIs.
  ( cd "$OH264_SRC" && git clean -fdx >/dev/null 2>&1 || make clean >/dev/null 2>&1 || true
    make -j"$(sysctl -n hw.ncpu)" OS=android ARCH="$OARCH" NDKROOT="$NDK" TARGET="android-$ANDROID_API" \
      $ASM PREFIX="$PREFIX" install-static ) || { echo "[openh264][$ABI] BUILD FAILED"; exit 1; }
  [ -f "$PREFIX/lib/libopenh264.a" ] || { echo "[openh264][$ABI] libopenh264.a not installed"; exit 1; }
  # openh264.pc declares `-lstdc++`, which the Android NDK doesn't have (it ships libc++). Rewrite to
  # the NDK's shared libc++; also append `-lm` because openh264's utils.cpp (WelsCalcPsnr) pulls in
  # log/logf/log10. Without these the FFmpeg configure link test + the engine link fail to resolve.
  perl -pi -e 's/-lstdc\+\+/-lc++_shared/g; s/(-lopenh264\b)(?!.*-lm)/$1 -lm/' "$PREFIX/lib/pkgconfig/openh264.pc"
  # Linking libc++ pulls `-lpthread`/`-lrt`, but Android keeps those IN libc (no separate .so). Drop
  # empty stub archives so those `-l` flags resolve to nothing during FFmpeg's configure + engine link.
  "$TOOLCHAIN/bin/llvm-ar" rc "$PREFIX/lib/libpthread.a" 2>/dev/null
  "$TOOLCHAIN/bin/llvm-ar" rc "$PREFIX/lib/librt.a" 2>/dev/null
  echo "[openh264][$ABI] installed → $PREFIX"
}

# Cross-build libvpx (static, DECODE-ONLY) — the only path that reads WebM (VP9) alpha overlays; the
# native FFmpeg vp9 decoder ignores the alpha stream. Uses libvpx's portable `generic-gnu` target (pure
# C, no nasm/SIMD — libvpx's `*-android-gcc` targets want the legacy gcc/`--sdk-path` toolchain the NDK
# r27 no longer ships) with the NDK clang supplied via CC/AR/etc; the clang triple does the cross. Installs
# libvpx.a + vpx.pc into the shared per-abi prefix, already on build-android.sh's PKG_CONFIG_PATH.
build_libvpx_abi() {
  local ABI="$1" PREFIX TRIPLE CC
  PREFIX="$DEPS_DIR/android/$ABI"
  TRIPLE="$(abi_to_triple "$ABI")"
  CC="$TOOLCHAIN/bin/${TRIPLE}${ANDROID_API}-clang"
  echo "[libvpx][$ABI] configure (generic-gnu) ..."
  ( cd "$LIBVPX_SRC" && make distclean >/dev/null 2>&1 || true
    CC="$CC" CXX="${CC}++" LD="$CC" AS="$CC" \
    AR="$TOOLCHAIN/bin/llvm-ar" RANLIB="$TOOLCHAIN/bin/llvm-ranlib" \
    STRIP="$TOOLCHAIN/bin/llvm-strip" NM="$TOOLCHAIN/bin/llvm-nm" \
    ./configure --target=generic-gnu --prefix="$PREFIX" \
      --enable-static --disable-shared --enable-pic --disable-runtime-cpu-detect \
      --enable-vp8 --enable-vp9 --disable-vp8-encoder --disable-vp9-encoder \
      --disable-examples --disable-tools --disable-docs --disable-unit-tests \
      --extra-cflags="-fPIC -O2"
    make -j"$(sysctl -n hw.ncpu)"
    make install ) || { echo "[libvpx][$ABI] BUILD FAILED"; exit 1; }
  [ -f "$PREFIX/lib/libvpx.a" ] || { echo "[libvpx][$ABI] libvpx.a not installed"; exit 1; }
  echo "[libvpx][$ABI] installed → $PREFIX"
}

build_abi() {
  local ABI="$1" TRIPLE HOST CC PREFIX
  TRIPLE="$(abi_to_triple "$ABI")"
  HOST="$(abi_to_host "$ABI")"
  CC="$TOOLCHAIN/bin/${TRIPLE}${ANDROID_API}-clang"
  PREFIX="$DEPS_DIR/android/$ABI"

  echo "[freetype][$ABI] configure ..."
  ( cd "$FT_SRC" && make distclean >/dev/null 2>&1 || true
    ./configure \
      --host="$HOST" --prefix="$PREFIX" \
      --enable-static --disable-shared --with-pic \
      --without-harfbuzz --without-png --without-zlib --without-brotli --without-bzip2 \
      CC="$CC" \
      AR="$TOOLCHAIN/bin/llvm-ar" RANLIB="$TOOLCHAIN/bin/llvm-ranlib" \
      CFLAGS="-O2 -fPIC -DANDROID -D__ANDROID_API__=$ANDROID_API"
    make -j"$(sysctl -n hw.ncpu)"
    make install
  )
  echo "[freetype][$ABI] installed → $PREFIX"
}

fetch_freetype
fetch_openh264
fetch_harfbuzz
fetch_libvpx
fetch_fribidi
ABIS=("$@")
[ ${#ABIS[@]} -eq 0 ] && read -ra ABIS <<< "$ANDROID_ABIS"
# Order matters: freetype first, then harfbuzz (needs freetype), then openh264 + libvpx + fribidi
# (independent).
for abi in "${ABIS[@]}"; do
  build_abi "$abi"; build_harfbuzz_abi "$abi"; build_openh264_abi "$abi"; build_libvpx_abi "$abi"
  build_fribidi_abi "$abi"
done
echo "[deps] android deps complete (freetype + harfbuzz + openh264 + libvpx + fribidi): ${ABIS[*]}"
