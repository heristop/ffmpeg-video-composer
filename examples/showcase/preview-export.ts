import path from 'node:path';

// Showcase previews: 960x540, letterboxed. Keep the authored soundtrack; sources without audio remain valid via the
// optional map.
export interface PreviewOptions {
  /** Output frame rate, or 'source' to keep the render's own (no decimation judder on fast motion). Default 24. */
  fps?: number | 'source';
  /** Audio gain in dB, e.g. to sit a long sample under the landing's level. */
  gainDb?: number;
}

function filter(fps: PreviewOptions['fps'] = 24): string {
  const frame =
    'scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=0x141416';

  return fps === 'source' ? frame : `${frame},fps=${fps}`;
}

function audioArgs(gainDb: number | undefined): string[] {
  return [...(gainDb === undefined ? [] : ['-af', `volume=${gainDb}dB`]), '-c:a', 'aac', '-b:a', '128k'];
}

// Tagged bt709 so every browser decodes the colours the same way (untagged H.264 freezes or shifts in some).
const H264 = [
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-pix_fmt',
  'yuv420p',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
];

export function previewVideoArgs(source: string, destination: string, options: PreviewOptions = {}): string[] {
  return [
    '-i',
    source,
    '-vf',
    filter(options.fps),
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    ...audioArgs(options.gainDb),
    ...H264,
    '-crf',
    '26',
    '-movflags',
    '+faststart',
    destination,
  ];
}

/**
 * A two-pass preview at a fixed video bitrate, for a long sample whose size must stay under Cloudflare Pages'
 * 25 MiB per-file cap whatever its content. Returns the two ffmpeg argument lists, run in order.
 */
export function previewTwoPassArgs(
  source: string,
  destination: string,
  options: PreviewOptions & { videoBitrateK: number; passlog: string }
): [string[], string[]] {
  function pass(n: 1 | 2): string[] {
    return [
      '-i',
      source,
      '-vf',
      filter(options.fps),
      ...H264,
      '-b:v',
      `${options.videoBitrateK}k`,
      '-pass',
      String(n),
      '-passlogfile',
      options.passlog,
    ];
  }

  return [
    [...pass(1), '-an', '-f', 'null', '-'],
    [
      ...pass(2),
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      ...audioArgs(options.gainDb),
      '-movflags',
      '+faststart',
      destination,
    ],
  ];
}

// Samples encoded differently from the 24 fps, CRF 26 default. The effects tour keeps its 30 fps (decimating to 24
// drops one frame in five, and its fast moves, the before/after wipe first, judder), sits 3.5 dB under its render
// to stay below the landing's films, and is encoded in two passes to a size budget: at seven minutes it is the one
// preview near Cloudflare Pages' 25 MiB per-file cap.
const PREVIEW_ENCODE: Readonly<Partial<Record<string, PreviewOptions & { budgetMiB: number }>>> = {
  'effects-tour': { fps: 'source', gainDb: -3.5, budgetMiB: 23 },
};

/**
 * Encode one sample's preview: the default single pass, or the sample's own two-pass budget (the render's
 * duration read with `probe`, the pass log kept under `work`).
 */
export function encodePreview(
  sampleId: string,
  source: string,
  destination: string,
  tools: {
    ffmpeg: (args: string[]) => unknown;
    probe: (file: string) => { format: { duration: string | number } };
    work: string;
  }
): void {
  const encode = PREVIEW_ENCODE[sampleId];

  if (!encode) {
    tools.ffmpeg(previewVideoArgs(source, destination));

    return;
  }
  const seconds = Number(tools.probe(source).format.duration);
  // The budget covers the whole file: leave the 128 kb/s AAC track and ~2% container overhead out of the video.
  const videoBitrateK = Math.floor(((encode.budgetMiB * 1024 * 1024 * 8) / seconds / 1000) * 0.98 - 128);
  const passlog = path.join(tools.work, `${sampleId}-x264`);

  for (const args of previewTwoPassArgs(source, destination, { ...encode, videoBitrateK, passlog })) {
    tools.ffmpeg(args);
  }
}
