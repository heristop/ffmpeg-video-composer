// The default light colour of an fx primitive: a warm white leaning toward the theme accent. Split from the
// dispatcher (fx.ts) so the builder's live canvas preview resolves the same colour without loading the
// lowerings. Pure: a function of global.theme.

import { resolveTheme } from '@/core/theme/resolve';
import type { ThemeSpec } from '@/core/theme/themes';

export const WARM_WHITE = '#FFF8EE';
/** How far the default light colour leans toward the theme accent. */
const ACCENT_TINT = 0.12;

function hexChannels(color: string): number[] | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(color)?.[1];

  return hex ? [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) : null;
}

/** Warm white leaning ACCENT_TINT toward the theme accent (a non-hex accent keeps the warm white). */
export function defaultLightColor(theme: unknown): string {
  const accent = hexChannels(resolveTheme(theme as ThemeSpec | undefined)?.colors.accent ?? '');
  const base = hexChannels(WARM_WHITE) as number[];

  if (!accent) return WARM_WHITE;

  const mixed = base.map((value, i) => value + (accent[i] - value) * ACCENT_TINT);
  // Re-brighten so the brightest channel is full: a tinted light is still a light, never a grey.
  const gain = 255 / Math.max(...mixed);

  return `#${mixed
    .map((value) =>
      Math.round(value * gain)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase()}`;
}
