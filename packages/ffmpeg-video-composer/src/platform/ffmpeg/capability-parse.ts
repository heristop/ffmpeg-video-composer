// Parsers for the FFmpeg listings the capability probe reads. Pure, so they are tested against captured
// outputs without spawning FFmpeg.

/**
 * Filter names from `ffmpeg -hide_banner -filters`. A filter line is its flag column (`T.C`, `TS`, `..`,
 * `...`) then the name; the legend (`T.. = Timeline support`) has `=` as its second token.
 */
export function parseFilterNames(stdout: string): Set<string> {
  const names = new Set<string>();

  for (const line of stdout.split('\n')) {
    const [flags, name] = line.trim().split(/\s+/);

    if (name && name !== '=' && /^[A-Z.|]{2,4}$/.test(flags)) names.add(name);
  }

  return names;
}

/** The `--enable-…` switches of `ffmpeg -hide_banner -buildconf` (e.g. `libfreetype`, `gpl`). */
export function parseBuildconf(stdout: string): Set<string> {
  return new Set([...stdout.matchAll(/--enable-([\w-]+)/g)].map((match) => match[1]));
}

/** The version from `ffmpeg -version` (`6.1.1-3ubuntu5`, `n7.1`, `N-11834-g…`), or null. */
export function parseVersion(stdout: string): string | null {
  return /ffmpeg version (\S+)/.exec(stdout)?.[1] ?? null;
}

/**
 * The first meaningful error line of a failed one-frame probe, for the feature detail. FFmpeg prints
 * `No such filter: 'drawtext'` or `Cannot load default config file` style lines on stderr.
 */
export function probeError(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((text) => text.trim())
    .find((text) => text.length > 0 && !text.startsWith('ffmpeg version'));

  return (line ?? 'the probe failed').slice(0, 200);
}
