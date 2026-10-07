// The theme catalog: every built-in theme with its resolved tokens, plus the reference grammar. Served
// on its own (`themeCatalog()`) and inside the motion catalog, so an agent picks a palette, a type stack
// and a motion feel in the same call it picks presets.

import { resolveTheme } from './resolve';
import { MAX_ACCENT_ELEMENTS } from './accent';
import { MAX_FONT_FAMILIES } from './palette';
import { BUILTIN_THEMES, DEFAULT_THEME, THEME_COLOR_NAMES, THEME_FONT_NAMES, type ResolvedTheme } from './themes';

export interface ThemeCatalogEntry extends ResolvedTheme {
  description: string;
  extends?: string;
}

export interface ThemeCatalog {
  default: string;
  tokens: { colors: readonly string[]; fonts: readonly string[] };
  usage: string[];
  themes: ThemeCatalogEntry[];
}

const USAGE = [
  'Pick a look once with global.theme: a built-in name ("midnight"), or { extends, colors, fonts, radius, motion } ' +
    'to override single tokens of one.',
  'Reference colours as "$color.<name>" in any colour field, with an optional alpha: "$color.bg@0.55". Reference ' +
    'fonts as "$font.display" / "$font.body" / "$font.mono" in font and fontfile fields.',
  'Tokens are whole values only: "$color.accent" works, "c=$color.accent" does not.',
  'theme.motion fills global.motion when unset: energy, the $theme easing token and the $beat duration token.',
  `One accent per idea: put $color.accent on at most ${MAX_ACCENT_ELEMENTS} elements per section; use ` +
    '$color.fg, $color.muted and $color.brand for the rest.',
  `Stay on the palette: with a theme set, literal hex colours outside it and more than ${MAX_FONT_FAMILIES} font ` +
    'families are flagged (palette_drift); use $color.* / $font.* tokens instead.',
  'To match a reference image or clip, derive a theme object from its palette, texture and pacing (MCP ' +
    'extract_style, CLI `leclap style`) and set it as global.theme. Only palette and pacing carry over: never ' +
    'copy the reference’s subjects, logos or text.',
];

export function themeCatalog(): ThemeCatalog {
  return {
    default: DEFAULT_THEME,
    tokens: { colors: THEME_COLOR_NAMES, fonts: THEME_FONT_NAMES },
    usage: USAGE,
    themes: Object.entries(BUILTIN_THEMES).map(([name, input]) => ({
      ...(resolveTheme(name) as ResolvedTheme),
      description: input.description,
      ...(input.extends === undefined ? {} : { extends: input.extends }),
    })),
  };
}
