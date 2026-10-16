// Brand kits: a website's name, colours, fonts and logo, read by pattern from its HTML and CSS, and the
// theme and prompt rules they make. Pure; fetching lives in services/brand-fetch-node.ts (Node only).
// This is the public surface (re-exported by the Node entry); the parsers stay internal: import them from
// their own files.
export { brandPromptRules, brandTheme, sanitizeBrandName, type BrandTheme } from './theme';
export type { BrandColor, BrandFonts, BrandKit, BrandLogo } from './types';
