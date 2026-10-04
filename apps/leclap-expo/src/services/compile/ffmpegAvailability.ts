import type * as LeclapFfmpeg from '@/modules/leclap-ffmpeg';

/**
 * Whether the native `leclap-ffmpeg` engine is present in the running build. Dev clients built
 * before the module was added (or Expo Go) won't have it. The local compile entry checks before
 * rendering and reports an unavailable-engine error. Cached after the first probe.
 */
let cached: boolean | undefined;

export function isFFmpegAvailable(): boolean {
  if (cached !== undefined) {
    return cached;
  }

  try {
    const mod = require('@/modules/leclap-ffmpeg') as typeof LeclapFfmpeg;
    cached = Boolean(mod.version());
  } catch {
    cached = false;
  }

  return cached;
}

/** Test seam: reset the memoized probe. */
export function __resetFFmpegAvailability(): void {
  cached = undefined;
}
