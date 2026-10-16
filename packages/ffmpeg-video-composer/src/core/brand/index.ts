// Brand kits: a website's name, colours, fonts and logo, read by pattern from its HTML and CSS, and the
// theme and prompt rules they make. Pure; fetching lives in services/brand-fetch-node.ts (Node only).
export {
  cssColors,
  cssFonts,
  normalizeColor,
  withThemeColor,
  MAX_BRAND_COLORS,
  MAX_BRAND_FAMILIES,
  MAX_FAMILY_NAME,
} from './css';
export { parseBrandPage, type BrandPage } from './html';
export {
  brandPromptRules,
  brandTheme,
  nearestBundledFont,
  sanitizeBrandName,
  BRAND_HEADING,
  MAX_BRAND_NAME,
  type BrandTheme,
} from './theme';
export type { BrandColor, BrandFonts, BrandKit, BrandLogo } from './types';
