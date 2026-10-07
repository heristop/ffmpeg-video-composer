// Theme tokens: a named palette, type stack and motion feel per template (global.theme), resolved
// before lowering like the motion tokens.
export {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  THEME_COLOR_NAMES,
  THEME_FONT_NAMES,
  type ResolvedTheme,
  type ThemeColors,
  type ThemeFonts,
  type ThemeInput,
  type ThemeMotion,
  type ThemeSpec,
} from './themes';
export {
  parseThemeRef,
  resolveTheme,
  resolveThemeDescriptor,
  resolveThemeRef,
  themedMotion,
  type ThemeRef,
} from './resolve';
export { nearestName, validateTheme } from './validate';
export { MAX_ACCENT_ELEMENTS, findAccentOveruse, type AccentWarning } from './accent';
export {
  MAX_FONT_FAMILIES,
  PALETTE_DRIFT_DELTA,
  findPaletteDrift,
  parseHexColor,
  type PaletteWarning,
} from './palette';
export { themeCatalog, type ThemeCatalog, type ThemeCatalogEntry } from './catalog';
