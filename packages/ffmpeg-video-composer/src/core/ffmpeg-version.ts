// What the engine knows about an FFmpeg build from its `-version` number alone. The one place that
// branches on the FFmpeg release: everything version-dependent (encoder colour tags, CLI syntax) asks
// here instead of parsing the version itself. Pure, so every branch is unit-tested without a binary.

export interface FFmpegVersion {
  major: number;
  minor: number;
}

/**
 * The release number of an `ffmpeg -version` string (`9.0.2`, `n7.1`, `6.1.1-3ubuntu5`,
 * `8.1-static`), or null for a git snapshot (`N-127141-g…`), the WASM core label or nothing at all.
 */
export function parseFFmpegVersion(version: string | null | undefined): FFmpegVersion | null {
  const match = /^n?(\d+)\.(\d+)/.exec(version ?? '');

  if (!match) return null;

  return { major: Number(match[1]), minor: Number(match[2]) };
}

function compare(found: FFmpegVersion, major: number, minor: number): number {
  return found.major === major ? found.minor - minor : found.major - major;
}

/**
 * Whether a known release is at least major.minor. An unknown version (a git snapshot, the WASM core,
 * the on-device engine) is `false`, so those keep the historical flags.
 */
export function ffmpegAtLeast(version: string | null | undefined, major: number, minor: number): boolean {
  const found = parseFFmpegVersion(version);

  return found !== null && compare(found, major, minor) >= 0;
}

/** Whether a known release predates major.minor. An unknown version is `false` (assumed current). */
export function ffmpegOlderThan(version: string | null | undefined, major: number, minor: number): boolean {
  const found = parseFFmpegVersion(version);

  return found !== null && compare(found, major, minor) < 0;
}

/** A git snapshot (`N-127141-g…`): newer than every numbered release, so treated as current. */
function isSnapshot(version: string | null | undefined): boolean {
  return /^N-\d+/.test(version ?? '');
}

export interface FFmpegCompat {
  /**
   * How an option's value is read from a file. `slash` is the `-/filter_complex graph.txt` form (FFmpeg
   * 7.0+, the only one FFmpeg 9 accepts); `script` is `-filter_complex_script` / `-filter_script:v`,
   * deprecated in 7.0 and removed in 9.0, but the only form FFmpeg 6 (ffmpeg-static) knows. An unknown
   * version gets `slash`.
   */
  optionFiles: 'slash' | 'script';
  /**
   * Whether `-shortest` keeps the whole of a stream-copied video read through the concat demuxer while
   * the concat's own audio is decoded and mixed. FFmpeg 9 ends that video ~0.1s (a few frames) early,
   * so the music pass reads an assembled file there instead of folding the concat into it. An unknown
   * version (the on-device 8.0 engine, the WASM core) keeps the historical `true`.
   */
  shortestKeepsConcatVideo: boolean;
}

/** What the `ffmpeg` of `version` accepts and how it behaves where the engine depends on it. */
export function ffmpegCompat(version: string | null | undefined): FFmpegCompat {
  return {
    optionFiles: ffmpegOlderThan(version, 7, 0) ? 'script' : 'slash',
    shortestKeepsConcatVideo: !(ffmpegAtLeast(version, 9, 0) || isSnapshot(version)),
  };
}
