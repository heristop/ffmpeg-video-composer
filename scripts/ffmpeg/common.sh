#!/usr/bin/env bash
# Shared configuration for the FFmpeg cross-builds. Sourced by build-android.sh / build-ios.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/versions.env"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_DIR="$REPO_ROOT/scripts/ffmpeg/.work"
SRC_DIR="$WORK_DIR/ffmpeg-$FFMPEG_VERSION"
DIST_DIR="$REPO_ROOT/scripts/ffmpeg/dist"

# Full build for the on-device CLI engine: the `ffmpeg`/`ffprobe` PROGRAMS are built (fftools objects
# are embedded into the engine .so), drawtext is enabled via libfreetype, and the set covers every
# command the core (SegmentBuilder/FilterManager/MusicComposer/VideoEditor) emits — including every
# animation-overlay format. `--enable-zlib` is REQUIRED: the `png` AND `apng` decoders select the zlib
# `inflate_wrapper`, so without it `--disable-autodetect` drops both (PNG/APNG overlays fail with rc=-22
# even though the demuxer is present). `--enable-libvpx` + the `libvpx_vp9` decoder add WebM transparency
# — the native `vp9` decoder ignores the alpha (BlockAdditional) stream, only libvpx decodes it.
# `--disable-ffplay` avoids the SDL dependency (we only need ffmpeg + ffprobe).
# lavfi sources are filters too: the editor emits `color`, `anullsrc`, `aevalsrc` (silent-audio
# padding) and `gradients` (gradient background layers) — all LGPL (no `_deps` in configure), so each
# must be in the --enable-filter list or the render fails only on device. `sine` is not emitted by the
# editor but is enabled defensively (cheap, LGPL, occasionally useful for silent-audio debugging).
# `null` is the FilterManager drop-path no-op (a compat rule with no device equivalent degrades to it
# rather than emitting a filter the engine will die on) — also enabled defensively. `boxblur` is
# deliberately absent: boxblur_filter_deps="gpl" (configure:3926), so under --disable-gpl configure silently drops
# it — listing it was dead config; blur on device is `gblur`. `lut3d`/`colorkey`/`split` (LUT looks,
# chroma key), `setparams` (colour-metadata tagging on every segment) and `atempo`/`asplit`/`loudnorm`/
# `dynaudnorm` (speed audio, ducking mix, normalize) are guarded the same way by
# tests/lgpl-filter-audit.test.ts, which cross-checks every filter the engine can emit against this
# list (or a FILTER_COMPAT rewrite/drop) — extend both together when a preset or manager starts
# emitting a new filter.
# `alphamerge` (LGPL) drives the mask features: gradient/texture-filled kinetic text copies a white-on-
# black drawtext mask into the fill's alpha. The engine gates it via engineCapabilities (no alphamerge
# → solid text + a warning), so an engine built before this line keeps rendering.
# `--enable-libfribidi` (LGPL-2.1, built by build-deps.sh / build-deps-ios.sh) adds the drawtext
# `text_shaping` option: bidi reordering for Arabic/Hebrew copy on top of HarfBuzz shaping. The engine
# reads this flag (device-filters.generated.ts DEVICE_LIBRARIES) to advertise textShaping on device.
# Audio polish: `acompressor`/`agate`/`alimiter`/`equalizer` (voice clean-up presets) and `adelay` (sound-
# effect placement) are LGPL (no `_deps` in configure; af_sidechaincompress.c, af_agate.c, af_alimiter.c,
# af_biquads.c, af_adelay.c).
FF_COMMON="--enable-static --disable-shared --enable-pic --enable-version3 --disable-gpl \
 --disable-ffplay --disable-doc --disable-autodetect \
 --enable-zlib \
 --enable-libfreetype --enable-libharfbuzz --enable-libfribidi --enable-libopenh264 --enable-libvpx \
 --enable-avformat --enable-avcodec --enable-avfilter --enable-swscale --enable-swresample \
 --enable-protocol=file,pipe \
 --enable-demuxer=mov,matroska,m4a,mp3,aac,wav,concat,lavfi,image2,apng,gif \
 --enable-muxer=mp4,mov \
 --enable-parser=h264,hevc,aac,mpeg4video,png,mjpeg,vp9 \
 --enable-decoder=h264,hevc,aac,mp3,pcm_s16le,mpeg4,png,mjpeg,apng,gif,webp,vp9,libvpx_vp9 \
 --enable-encoder=aac,mpeg4,libopenh264 \
 --enable-filter=scale,crop,pad,setsar,setdar,format,fps,trim,setpts,settb,fade,drawtext,overlay,concat,xfade,loop,tile,\
alphamerge,\
drawbox,gblur,noise,hue,vignette,hflip,vflip,rotate,transpose,negate,colorchannelmixer,colorbalance,curves,zoompan,lutyuv,\
lut3d,colorkey,split,setparams,null,rgbashift,edgedetect,\
atrim,asetpts,aresample,aformat,amix,afade,acrossfade,afftdn,sidechaincompress,volume,anull,anullsrc,aevalsrc,color,sine,gradients,\
acompressor,adelay,agate,alimiter,equalizer,\
atempo,asplit,loudnorm,dynaudnorm,aecho,highpass,lowpass \
 --enable-bsf=h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc"

# Fetch the FFmpeg source once (shallow), cached under .work/.
fetch_ffmpeg() {
  mkdir -p "$WORK_DIR"
  if [ ! -f "$SRC_DIR/configure" ]; then
    echo "[ffmpeg] cloning $FFMPEG_VERSION ..."
    git clone --depth 1 --branch "$FFMPEG_VERSION" https://github.com/FFmpeg/FFmpeg.git "$SRC_DIR"
  else
    echo "[ffmpeg] source already present at $SRC_DIR"
  fi
}
