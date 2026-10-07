// accent_overuse (advisory): one accent per composition idea. An accent on every element stops
// pointing at anything, so more than MAX_ACCENT_ELEMENTS distinct elements of one section using the
// theme accent — as `$color.accent[@alpha]`, or as the explicit theme's accent hex — is flagged.
// Guidance only: it never fails validation.

import { parseThemeRef, resolveTheme } from './resolve';
import type { ThemeSpec } from './themes';

/** Distinct elements of one section that may carry the accent before the advisory fires. */
export const MAX_ACCENT_ELEMENTS = 2;

export interface AccentWarning {
  path: string;
  message: string;
  code: 'accent_overuse';
}

interface Loose {
  global?: { theme?: ThemeSpec } & Record<string, unknown>;
  sections?: unknown[];
}

function isAccent(value: string, accentHex: string | undefined): boolean {
  const ref = parseThemeRef(value);

  if (ref) return ref.namespace === 'color' && ref.name === 'accent';

  return accentHex !== undefined && value.trim().toLowerCase().split('@')[0] === accentHex;
}

// Paths of the objects (filters, overlays, kinetic blocks…) that own at least one accent value.
function accentOwners(value: unknown, path: string, accentHex: string | undefined, owners: Set<string>): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) accentOwners(item, `${path}[${index}]`, accentHex, owners);

    return;
  }

  if (value === null || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && isAccent(child, accentHex)) owners.add(path);

    accentOwners(child, `${path}.${key}`, accentHex, owners);
  }
}

/** Sections that put the theme accent on more than MAX_ACCENT_ELEMENTS elements. */
export function findAccentOveruse(template: Loose): AccentWarning[] {
  const spec = template.global?.theme;
  const accentHex = spec === undefined ? undefined : resolveTheme(spec)?.colors.accent.toLowerCase();

  return (template.sections ?? []).flatMap((section, index): AccentWarning[] => {
    const owners = new Set<string>();
    const path = `sections[${index}]`;

    accentOwners(section, path, accentHex, owners);

    if (owners.size <= MAX_ACCENT_ELEMENTS) return [];

    const name = (section as { name?: unknown }).name;

    return [
      {
        path,
        message:
          `Section "${String(name)}": the accent colour is on ${owners.size} elements; keep it to ` +
          `${MAX_ACCENT_ELEMENTS} so it still points at one idea (use $color.fg, $color.muted or $color.brand for the rest)`,
        code: 'accent_overuse',
      },
    ];
  });
}

/**
 * The accent advisory shaped for the motion warning list (severity + hint), so every surface that shows
 * pacing feedback shows it too. Like the rest of that list it never throws, whatever the input.
 */
export function accentAdvisories(template: unknown): Array<AccentWarning & { severity: 'warn'; hint: string }> {
  try {
    return findAccentOveruse(template as Loose).map((warning) => ({
      ...warning,
      severity: 'warn' as const,
      hint: 'Keep the accent for one element per section; use $color.fg, $color.muted or $color.brand for the rest.',
    }));
  } catch {
    return [];
  }
}
