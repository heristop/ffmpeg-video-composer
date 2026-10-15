// Brand kits: a website's name, colours, fonts and logo, read by pattern from its HTML and CSS, and the
// theme and prompt rules they make. Pure; fetching lives in services/brand-fetch-node.ts (Node only).
export { cssColors, cssFonts, normalizeColor } from './css';
export { parseBrandPage, type BrandPage } from './html';
export { brandPromptRules, brandTheme, nearestBundledFont, BRAND_HEADING, type BrandTheme } from './theme';
export type { BrandColor, BrandFonts, BrandKit, BrandLogo } from './types';
