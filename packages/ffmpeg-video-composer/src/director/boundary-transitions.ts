import type { ProjectBuildInfos, Section } from '@/core/types';
import { DEFAULT_TRANSITION_DURATION } from '../schemas/effects.schemas';
import { DRIP_FALLBACK_COLOR } from '@/core/motion/transition-drip';
import { BANDS_FALLBACK_COLORS } from '@/core/motion/transition-bands';
import { resolveTheme } from '@/core/theme/resolve';
import type { ThemeSpec } from '@/core/theme/themes';

type BoundaryTransition = ProjectBuildInfos['transitions'][number];

/** The `transition` a section or the descriptor's `global` declares. */
type DeclaredTransition = Section['transition'];

function transitionOptions(
  declared: NonNullable<DeclaredTransition>,
  globalTransition: DeclaredTransition,
  theme: unknown
): Pick<BoundaryTransition, 'origin' | 'rim' | 'color'> {
  const options = {
    ...(declared.origin ? { origin: declared.origin } : {}),
    ...(declared.rim ? { rim: declared.rim } : {}),
  };

  if (declared.type !== 'drip') return options;

  // The drip's paint: the authored colour (theme tokens already resolved), else the global drip colour,
  // else the theme accent.
  const accent = resolveTheme(theme as ThemeSpec | undefined)?.colors.accent;

  return { ...options, color: declared.color ?? globalTransition?.color ?? accent ?? DRIP_FALLBACK_COLOR };
}

/**
 * The per-boundary transitions of the N rendering sections (N-1 boundaries, in order). Each boundary
 * takes the transition of the EARLIER section or the global default; it is only a non-cut transition
 * when one is declared. Cut boundaries keep type 'cut' (duration 0 in timeline math).
 */
export function boundaryTransitions(
  segments: readonly Section[],
  globalTransition: DeclaredTransition,
  canCrossfade = true,
  theme?: unknown
): BoundaryTransition[] {
  return segments.slice(0, -1).map((segment) => {
    const declared = segment.transition ?? globalTransition;

    // An FFmpeg without a working xfade (Node capability probe) cuts instead of failing the assembly.
    if (!declared || declared.type === 'cut' || !canCrossfade) return { type: 'cut', duration: 0 };

    const duration = declared.duration ?? globalTransition?.duration ?? DEFAULT_TRANSITION_DURATION;

    return {
      type: declared.type,
      duration,
      ease: declared.ease,
      ...transitionOptions(declared, globalTransition, theme),
      ...designFields(declared, theme),
    };
  });
}

const DESIGN_KEYS = ['shape', 'through', 'count', 'angle', 'colors', 'stagger'] as const;

// The shape / window / bands fields that are set; bands default their colours to the theme's.
function designFields(declared: NonNullable<DeclaredTransition>, theme: unknown): Partial<BoundaryTransition> {
  const fields = Object.fromEntries(
    DESIGN_KEYS.flatMap((key) => (declared[key] === undefined ? [] : [[key, declared[key]]]))
  );

  if (declared.type !== 'bands' || declared.colors) return fields;

  const colors = resolveTheme(theme as ThemeSpec | undefined)?.colors;
  const palette = colors ? [colors.brand, colors.accent, colors.accent2, colors.fg] : [...BANDS_FALLBACK_COLORS];

  return { ...fields, colors: palette };
}
