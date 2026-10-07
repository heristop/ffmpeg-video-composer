// One entry per capability feature: what has to be listed or built in (`precheck`), the one-frame render
// that proves it really runs (`probe`, FFmpeg arguments after the common flags), and the fix to print
// when it does not. Pure: the probe (capability-probe-node.ts) runs them.

import type { CapabilityFeature, FeatureStatus } from '@/core/capabilities';
import { ffmpegAtLeast } from '@/core/encoding';

export interface ProbeContext {
  binary: string;
  version: string | null;
  filters: ReadonlySet<string>;
  encoders: readonly string[];
  buildconf: ReadonlySet<string>;
  fontFile: string | null;
  scratch: { cube: string; srt: string };
}

interface FeatureSpec {
  /** Detail when the feature works. */
  ok: string;
  fix: string;
  /** A settled answer before any render (missing from the listing, not built in), or null to go on. */
  precheck: (ctx: ProbeContext) => FeatureStatus | null;
  /** Arguments of the one-frame render, or null/absent when the precheck is the whole answer. */
  probe?: (ctx: ProbeContext) => string[] | null;
}

const FULL_BUILD =
  'install a full FFmpeg build (a static release build, or the ffmpeg-static package) and put it first on PATH';
const VIDEO = ['-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=25:d=0.2'];
const VIDEO_B = ['-f', 'lavfi', '-i', 'color=c=white:s=64x64:r=25:d=0.2'];
const AUDIO = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5'];
const NULL_FRAME = ['-frames:v', '1', '-f', 'null', '-'];
const NULL_AUDIO = ['-f', 'null', '-'];

/** A path quoted for a filter argument (`'…'`, a `'` closed, escaped and reopened). */
export function filterPath(file: string): string {
  return `'${file.replaceAll('\\', '/').replaceAll("'", String.raw`'\\''`)}'`;
}

function listed(...names: string[]): (ctx: ProbeContext) => FeatureStatus | null {
  return (ctx) => {
    const missing = names.filter((name) => !ctx.filters.has(name));

    if (missing.length === 0) return null;

    return { usable: 'no', detail: `this build has no ${missing.join('/')} filter`, fix: '' };
  };
}

function videoProbe(vf: string): () => string[] {
  return () => [...VIDEO, '-vf', vf, ...NULL_FRAME];
}

function drawtextProbe(ctx: ProbeContext): string[] {
  const font = ctx.fontFile ? `fontfile=${filterPath(ctx.fontFile)}:` : '';

  return [...VIDEO, '-vf', `drawtext=${font}text=Ag:fontsize=24:fontcolor=white:x=4:y=4`, ...NULL_FRAME];
}

function built(flag: string, detail: string): (ctx: ProbeContext) => FeatureStatus | null {
  return (ctx) => (ctx.buildconf.has(flag) ? null : { usable: 'no', detail, fix: '' });
}

function textShaping(ctx: ProbeContext): FeatureStatus {
  const harfbuzz = ctx.buildconf.has('libharfbuzz');
  const fribidi = ctx.buildconf.has('libfribidi');

  // drawtext's `text_shaping` option exists only in builds linking libfribidi (filter-compat.ts keys the
  // engine's textShaping capability off the same flag), so that is what decides.
  if (fribidi) return { usable: 'yes', detail: `built with libfribidi${harfbuzz ? ' and libharfbuzz' : ''}` };

  return { usable: 'no', detail: `built without libfribidi${harfbuzz ? ' (libharfbuzz only)' : ''}`, fix: '' };
}

function x264ColorParams(ctx: ProbeContext): FeatureStatus | null {
  if (!ctx.encoders.includes('libx264')) return { usable: 'no', detail: 'no libx264 encoder', fix: '' };

  if (!ffmpegAtLeast(ctx.version, 7, 1)) {
    return {
      usable: 'no',
      detail: `FFmpeg ${ctx.version ?? 'of unknown version'} is older than 7.1: the engine tags colour with -colorspace flags instead`,
      fix: '',
    };
  }

  return null;
}

export const FEATURE_SPECS: Record<CapabilityFeature, FeatureSpec> = {
  drawtext: {
    ok: 'drawtext renders text',
    fix: `this build has no working drawtext — captions, titles, lower thirds and kinetic text will be dropped; ${FULL_BUILD} (built with libfreetype)`,
    precheck: listed('drawtext'),
    probe: drawtextProbe,
  },
  textShaping: {
    ok: 'complex-script shaping available',
    fix: 'Arabic, Hebrew and Indic text renders unshaped; install a build configured with --enable-libharfbuzz --enable-libfribidi',
    precheck: textShaping,
  },
  libass: {
    ok: 'subtitles/ass filters render',
    fix: `subtitle burn-in is unavailable; ${FULL_BUILD} (built with libass)`,
    precheck: listed('subtitles', 'ass'),
    probe: (ctx) => [...VIDEO, '-vf', `subtitles=${filterPath(ctx.scratch.srt)}`, ...NULL_FRAME],
  },
  zscale: {
    ok: 'zscale renders',
    fix: `HDR conversion is unavailable; ${FULL_BUILD} (built with libzimg)`,
    precheck: listed('zscale'),
    probe: videoProbe('zscale=w=32:h=32'),
  },
  tonemap: {
    ok: 'tonemap renders',
    fix: `HDR tone mapping is unavailable; ${FULL_BUILD}`,
    precheck: listed('tonemap'),
    probe: videoProbe('format=gbrpf32le,tonemap=hable,format=yuv420p'),
  },
  lut3d: {
    ok: 'lut3d renders a .cube LUT',
    fix: `LUT looks (teal-orange, warm-film, mono-film, noir-film, vivid-pop) will be dropped; ${FULL_BUILD}`,
    precheck: listed('lut3d'),
    probe: (ctx) => [...VIDEO, '-vf', `lut3d=file=${filterPath(ctx.scratch.cube)}`, ...NULL_FRAME],
  },
  xfade: {
    ok: 'xfade renders',
    fix: `designed transitions will be rendered as cuts; ${FULL_BUILD} (FFmpeg 4.3 or newer)`,
    precheck: listed('xfade'),
    probe: () => [...VIDEO, ...VIDEO_B, '-filter_complex', '[0][1]xfade=duration=0.1:offset=0.05', ...NULL_FRAME],
  },
  gblur: {
    ok: 'gblur renders',
    fix: `blur grades and the dreamy look lose their blur; ${FULL_BUILD}`,
    precheck: listed('gblur'),
    probe: videoProbe('gblur=sigma=2'),
  },
  alphamerge: {
    ok: 'alphamerge renders',
    fix: `masked overlays are unavailable; ${FULL_BUILD}`,
    precheck: listed('alphamerge'),
    probe: () => [...VIDEO, ...VIDEO_B, '-filter_complex', '[1]format=gray[m];[0][m]alphamerge', ...NULL_FRAME],
  },
  loudnorm: {
    ok: 'loudnorm runs',
    fix: `global.audio.normalize "loudnorm" will fail; use "dynaudnorm" or ${FULL_BUILD}`,
    precheck: listed('loudnorm'),
    probe: () => [...AUDIO, '-af', 'loudnorm', ...NULL_AUDIO],
  },
  ebur128: {
    ok: 'ebur128 measures loudness',
    fix: `output QC cannot measure loudness; ${FULL_BUILD}`,
    precheck: listed('ebur128'),
    probe: () => [...AUDIO, '-af', 'ebur128', ...NULL_AUDIO],
  },
  libx264: {
    ok: 'libx264 encoder available',
    fix: 'the default H.264 encoder is missing; install a GPL build with libx264, or set codecConfig.videoCodec',
    precheck: (ctx) =>
      ctx.encoders.includes('libx264') ? null : { usable: 'no', detail: 'no libx264 encoder', fix: '' },
    probe: () => [...VIDEO, '-c:v', 'libx264', '-preset', 'ultrafast', ...NULL_FRAME],
  },
  x264ColorParams: {
    ok: 'libx264 writes Rec.709 tags itself (FFmpeg ≥ 7.1)',
    fix: 'optional: FFmpeg 7.1 or newer tags colour inside the H.264 stream without a conversion',
    precheck: x264ColorParams,
    probe: () => [
      ...VIDEO,
      '-c:v',
      'libx264',
      '-x264-params',
      'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv',
      ...NULL_FRAME,
    ],
  },
  gpl: {
    ok: 'GPL build (eq, boxblur, libx264)',
    fix: 'an LGPL build: eq is rewritten to lutyuv and boxblur is dropped; install a GPL build for the exact grades',
    precheck: built('gpl', 'LGPL build (configured without --enable-gpl)'),
  },
};
