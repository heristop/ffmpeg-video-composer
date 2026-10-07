import type { ResolvedPlatform } from '@/core/platforms';
import type { GeometryWarning } from './rules';
import type { LoweredSection } from './text-boxes';

// Delivery-platform judgement calls that are not about text placement (that one lives in
// rules.ts as `platform_ui_overlap`). Advisory like every other finding here: a template made for
// TikTok that runs long still renders, and the author may well trim it in the app.

// The frame rates every platform in core/platforms.ts ingests without resampling.
const MIN_PLATFORM_FPS = 24;
const MAX_PLATFORM_FPS = 60;

interface PlatformGlobal {
  orientation?: string;
  fps?: number;
}

function finding(path: string, code: string, message: string, approx = false): GeometryWarning {
  const base: GeometryWarning = { path, code, message, severity: 'warn', approx };

  return approx ? { ...base, approxReason: 'duration' } : base;
}

// The rendered timeline is the renderable sections end to end. A transition overlaps two sections
// and shortens it slightly, so this errs long by at most a second per transition; a section without
// a duration counts as the geometry model's assumed window and marks the finding approximate.
function durationWarning(lowered: LoweredSection[], platform: ResolvedPlatform): GeometryWarning | null {
  const total = lowered.reduce((sum, entry) => sum + entry.duration, 0);
  const excess = total - platform.maxDuration;

  if (excess <= 0) {
    return null;
  }

  return finding(
    'sections',
    'platform_duration_exceeded',
    `The video runs ${total.toFixed(1)}s, ${excess.toFixed(1)}s over ${platform.title}'s ${platform.maxDuration}s ` +
      'limit — shorten or drop sections',
    lowered.some((entry) => entry.timingAssumed)
  );
}

function fpsWarning(fps: number | undefined, platform: ResolvedPlatform): GeometryWarning | null {
  if (fps === undefined || (fps >= MIN_PLATFORM_FPS && fps <= MAX_PLATFORM_FPS)) {
    return null;
  }

  return finding(
    'global.fps',
    'platform_fps_mismatch',
    `${fps} fps is outside the ${MIN_PLATFORM_FPS}..${MAX_PLATFORM_FPS} fps range ${platform.title} plays back natively — ` +
      `use ${platform.fps}`
  );
}

function orientationWarning(orientation: string | undefined, platform: ResolvedPlatform): GeometryWarning | null {
  if (orientation === undefined || orientation === platform.orientation) {
    return null;
  }

  return finding(
    'global.orientation',
    'platform_orientation_mismatch',
    `${platform.title} expects ${platform.orientation} video but global.orientation is ${orientation} — ` +
      'remove global.orientation to use the platform default'
  );
}

export function platformWarnings(
  lowered: LoweredSection[],
  global: PlatformGlobal | undefined,
  platform: ResolvedPlatform | undefined
): GeometryWarning[] {
  if (!platform) {
    return [];
  }

  return [
    durationWarning(lowered, platform),
    orientationWarning(global?.orientation, platform),
    fpsWarning(global?.fps, platform),
  ].filter((warning): warning is GeometryWarning => warning !== null);
}
