#!/usr/bin/env bash
# Cross-build the FFmpeg drawtext deps (libfreetype + libharfbuzz + libfribidi, static) for iOS slices, mirroring
# build-deps.sh's Android recipe but with the Xcode toolchain. Output:
#   scripts/ffmpeg/deps/ios/<slice>/{lib,include} + pkg-config files build-ios.sh points configure at.
# Slices: device (arm64/iphoneos), sim-arm64, sim-x86_64. openh264 is intentionally omitted — drawtext
# parity needs only freetype+harfbuzz; H.264 (libopenh264) is added later for production encoding.
# Usage: build-deps-ios.sh [slice ...]   (default: all three)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

DEPS_DIR="$SCRIPT_DIR/deps"
FT_DOTTED="$(echo "$FREETYPE_VERSION" | sed 's/^VER-//; s/-/./g')"
FT_SRC="$WORK_DIR/freetype-$FT_DOTTED"
HB_SRC="$WORK_DIR/harfbuzz-$HARFBUZZ_VERSION"
LIBVPX_SRC="$WORK_DIR/libvpx-$LIBVPX_VERSION"
FRIBIDI_SRC="$WORK_DIR/fribidi-$FRIBIDI_VERSION"

# slice → (sdk, arch, autotools host triple, min-version flag)
slice_sdk()  { case "$1" in device) echo iphoneos;; sim-arm64|sim-x86_64) echo iphonesimulator;; esac; }
slice_arch() { case "$1" in device|sim-arm64) echo arm64;; sim-x86_64) echo x86_64;; esac; }
slice_host() { case "$1" in sim-x86_64) echo x86_64-apple-darwin;; *) echo aarch64-apple-darwin;; esac; }
slice_min()  { case "$1" in device) echo "-mios-version-min=$IOS_MIN";; *) echo "-mios-simulator-version-min=$IOS_MIN";; esac; }

fetch_freetype() {
  mkdir -p "$WORK_DIR"
  [ -f "$FT_SRC/configure" ] || curl -fsSL \
    "https://download.savannah.gnu.org/releases/freetype/freetype-$FT_DOTTED.tar.gz" | tar -xz -C "$WORK_DIR"
}
fetch_harfbuzz() {
  [ -f "$HB_SRC/CMakeLists.txt" ] || curl -fsSL \
    "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ_VERSION/harfbuzz-$HARFBUZZ_VERSION.tar.xz" | tar -xJ -C "$WORK_DIR"
}
fetch_fribidi() {
  [ -f "$FRIBIDI_SRC/configure" ] || curl -fsSL \
    "https://github.com/fribidi/fribidi/releases/download/v$FRIBIDI_VERSION/fribidi-$FRIBIDI_VERSION.tar.xz" | tar -xJ -C "$WORK_DIR"
}
fetch_libvpx() {
  [ -f "$LIBVPX_SRC/configure" ] || git clone --depth 1 --branch "v$LIBVPX_VERSION" \
    https://chromium.googlesource.com/webm/libvpx "$LIBVPX_SRC"
}

build_freetype() {
  local SLICE="$1" SDK ARCH HOST MIN SYSROOT CC PREFIX
  SDK="$(slice_sdk "$SLICE")"; ARCH="$(slice_arch "$SLICE")"; HOST="$(slice_host "$SLICE")"; MIN="$(slice_min "$SLICE")"
  SYSROOT="$(xcrun --sdk "$SDK" --show-sdk-path)"; CC="$(xcrun --sdk "$SDK" --find clang)"
  PREFIX="$DEPS_DIR/ios/$SLICE"
  echo "[freetype][ios:$SLICE] configure ($ARCH/$SDK) ..."
  ( cd "$FT_SRC" && make distclean >/dev/null 2>&1 || true
    ./configure \
      --host="$HOST" --prefix="$PREFIX" \
      --enable-static --disable-shared --with-pic \
      --without-harfbuzz --without-png --without-zlib --without-brotli --without-bzip2 \
      CC="$CC" \
      CFLAGS="-arch $ARCH $MIN -isysroot $SYSROOT -fPIC -O2"
    make -j"$(sysctl -n hw.ncpu)"
    make install )
  echo "[freetype][ios:$SLICE] installed → $PREFIX"
}

build_harfbuzz() {
  local SLICE="$1" SDK ARCH MIN SYSROOT PREFIX BUILD SYSNAME
  SDK="$(slice_sdk "$SLICE")"; ARCH="$(slice_arch "$SLICE")"; MIN="$(slice_min "$SLICE")"
  SYSROOT="$(xcrun --sdk "$SDK" --show-sdk-path)"
  PREFIX="$DEPS_DIR/ios/$SLICE"; BUILD="$HB_SRC/build-ios-$SLICE"
  echo "[harfbuzz][ios:$SLICE] cmake configure ..."
  rm -rf "$BUILD"
  cmake -G Ninja -S "$HB_SRC" -B "$BUILD" \
    -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT="$SYSROOT" -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$IOS_MIN" \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DHB_HAVE_FREETYPE=ON -DHB_HAVE_GLIB=OFF -DHB_HAVE_ICU=OFF \
    -DHB_HAVE_GRAPHITE2=OFF -DHB_HAVE_CORETEXT=OFF -DHB_BUILD_TESTS=OFF -DHB_BUILD_UTILS=OFF \
    -DCMAKE_PREFIX_PATH="$PREFIX" \
    -DFREETYPE_LIBRARY="$PREFIX/lib/libfreetype.a" \
    -DFREETYPE_INCLUDE_DIR_ft2build="$PREFIX/include/freetype2" \
    -DFREETYPE_INCLUDE_DIR_freetype2="$PREFIX/include/freetype2" \
    >/dev/null || { echo "[harfbuzz][ios:$SLICE] CONFIGURE FAILED"; exit 1; }
  cmake --build "$BUILD" || { echo "[harfbuzz][ios:$SLICE] BUILD FAILED"; exit 1; }
  cmake --install "$BUILD" >/dev/null || { echo "[harfbuzz][ios:$SLICE] INSTALL FAILED"; exit 1; }
  [ -f "$PREFIX/lib/libharfbuzz.a" ] || { echo "[harfbuzz][ios:$SLICE] libharfbuzz.a missing"; exit 1; }
  # CMake emits no .pc — write the one FFmpeg's configure needs. iOS links the system libc++ (-lc++).
  mkdir -p "$PREFIX/lib/pkgconfig"
  cat > "$PREFIX/lib/pkgconfig/harfbuzz.pc" <<EOF
prefix=$PREFIX
libdir=\${prefix}/lib
includedir=\${prefix}/include
Name: harfbuzz
Description: HarfBuzz text shaping library
Version: $HARFBUZZ_VERSION
Requires.private: freetype2
Libs: -L\${libdir} -lharfbuzz -lc++ -lm
Cflags: -I\${includedir}/harfbuzz
EOF
  echo "[harfbuzz][ios:$SLICE] installed → $PREFIX"
}

# libvpx's configure has no --extra-ldflags (unlike FFmpeg's); its check_ld honors the LDFLAGS env
# var instead. The sysroot must reach the LINK check too — Xcode 26+ clang otherwise fails it with
# "ld: library 'System' not found" and configure aborts with "Toolchain is unable to link executables".
# Cross-build libvpx (static, DECODE-ONLY) for iOS — reads WebM (VP9) alpha overlays the native vp9
# decoder can't. Uses libvpx's portable `generic-gnu` target (pure C, no nasm) with the Xcode clang and
# -arch/-isysroot, so it builds for every slice without libvpx's version-named darwin targets. Installs
# libvpx.a + vpx.pc into the per-slice prefix build-ios.sh already has on PKG_CONFIG_PATH.
build_libvpx() {
  local SLICE="$1" SDK ARCH MIN SYSROOT CC PREFIX
  SDK="$(slice_sdk "$SLICE")"; ARCH="$(slice_arch "$SLICE")"; MIN="$(slice_min "$SLICE")"
  SYSROOT="$(xcrun --sdk "$SDK" --show-sdk-path)"; CC="$(xcrun --sdk "$SDK" --find clang)"
  PREFIX="$DEPS_DIR/ios/$SLICE"
  echo "[libvpx][ios:$SLICE] configure ($ARCH/$SDK) ..."
  ( cd "$LIBVPX_SRC" && make distclean >/dev/null 2>&1 || true
    CC="$CC" CXX="$CC" LD="$CC" AS="$CC" \
    AR="$(xcrun --sdk "$SDK" --find ar)" RANLIB="$(xcrun --sdk "$SDK" --find ranlib)" \
    STRIP="$(xcrun --sdk "$SDK" --find strip)" NM="$(xcrun --sdk "$SDK" --find nm)" \
    LDFLAGS="-arch $ARCH $MIN -isysroot $SYSROOT" \
    ./configure --target=generic-gnu --prefix="$PREFIX" \
      --enable-static --disable-shared --enable-pic \
      --enable-vp8 --enable-vp9 --disable-vp8-encoder --disable-vp9-encoder \
      --disable-examples --disable-tools --disable-docs --disable-unit-tests \
      --extra-cflags="-arch $ARCH $MIN -isysroot $SYSROOT -fPIC -O2"
    make -j"$(sysctl -n hw.ncpu)"
    make install ) || { echo "[libvpx][ios:$SLICE] BUILD FAILED"; exit 1; }
  [ -f "$PREFIX/lib/libvpx.a" ] || { echo "[libvpx][ios:$SLICE] libvpx.a not installed"; exit 1; }
  echo "[libvpx][ios:$SLICE] installed → $PREFIX"
}

# libfribidi (static, LGPL-2.1, pure C) — drawtext `text_shaping` (bidi reordering), mirroring
# build-deps.sh: autotools like freetype, library subdir only, fribidi.pc into the per-slice prefix.
build_fribidi() {
  local SLICE="$1" SDK ARCH HOST MIN SYSROOT CC PREFIX
  SDK="$(slice_sdk "$SLICE")"; ARCH="$(slice_arch "$SLICE")"; HOST="$(slice_host "$SLICE")"; MIN="$(slice_min "$SLICE")"
  SYSROOT="$(xcrun --sdk "$SDK" --show-sdk-path)"; CC="$(xcrun --sdk "$SDK" --find clang)"
  PREFIX="$DEPS_DIR/ios/$SLICE"
  echo "[fribidi][ios:$SLICE] configure ($ARCH/$SDK) ..."
  ( cd "$FRIBIDI_SRC" && make distclean >/dev/null 2>&1 || true
    ./configure \
      --host="$HOST" --prefix="$PREFIX" \
      --enable-static --disable-shared --with-pic --disable-debug --disable-deprecated \
      CC="$CC" \
      CFLAGS="-arch $ARCH $MIN -isysroot $SYSROOT -fPIC -O2" \
      LDFLAGS="-arch $ARCH $MIN -isysroot $SYSROOT"
    make -j"$(sysctl -n hw.ncpu)" -C lib
    make -C lib install
    make install-pkgconfigDATA ) || { echo "[fribidi][ios:$SLICE] BUILD FAILED"; exit 1; }
  [ -f "$PREFIX/lib/libfribidi.a" ] || { echo "[fribidi][ios:$SLICE] libfribidi.a not installed"; exit 1; }
  echo "[fribidi][ios:$SLICE] installed → $PREFIX"
}

fetch_freetype
fetch_harfbuzz
fetch_libvpx
fetch_fribidi
SLICES=("$@")
[ ${#SLICES[@]} -eq 0 ] && SLICES=(device sim-arm64 sim-x86_64)
for slice in "${SLICES[@]}"; do
  build_freetype "$slice"; build_harfbuzz "$slice"; build_libvpx "$slice"; build_fribidi "$slice"
done
echo "[deps] ios deps complete (freetype + harfbuzz + libvpx + fribidi): ${SLICES[*]}"
