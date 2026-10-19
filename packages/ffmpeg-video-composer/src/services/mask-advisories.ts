// mask_unavailable (only when the caller names the target build's capabilities): a build without alphamerge
// cannot composite a mask. The render still succeeds (editor/presets/layer-masks.ts, section-mask.ts): a shape
// is cut to its resting box, an inverted shape or a track matte draws unmasked. Render-free, never an error.

import type { MotionWarning } from './motion-lint';
import { maskFallback } from '../editor/presets/mask-fallback';
import { maskSites } from './mask-validation';

/** What the advisory needs to know of the target build. */
interface MaskCapabilities {
  masks: boolean;
}

function fallback(mask: Record<string, unknown>): string {
  const { need, outcome } = maskFallback(mask);

  return `${need} needs alphamerge, absent from the target build: ${outcome}`;
}

export function maskAdvisories(template: unknown, caps: MaskCapabilities): MotionWarning[] {
  if (caps.masks) return [];

  return maskSites(template).map(({ mask, path }) => ({
    path,
    code: 'mask_unavailable',
    severity: 'warn',
    message: fallback(mask),
    hint: 'Rebuild the on-device engine (scripts/ffmpeg/build-engine.sh) or render with an FFmpeg that has alphamerge.',
  }));
}
