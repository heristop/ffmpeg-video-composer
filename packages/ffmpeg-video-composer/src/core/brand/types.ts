// packages/ffmpeg-video-composer/src/core/brand/types.ts
// A brand kit read from a website: its name, colours (with how strongly the site uses them), fonts and logo.

export interface BrandColor {
  hex: string;
  /** How strongly the site uses it: theme-color and brand-named custom properties weigh most. */
  weight: number;
  source: 'theme-color' | 'custom-property' | 'declaration';
}

export interface BrandFonts {
  /** Headings' family (h1–h3, .title, .display, .heading). */
  display: string | null;
  /** Body copy's family (html, body, :root). */
  body: string | null;
  /** Code's family (code, pre, kbd, .mono). */
  mono: string | null;
  /** Every first-choice family the site names, in order of appearance, deduplicated. */
  families: string[];
}

export interface BrandLogo {
  url: string;
  type: 'png' | 'svg' | 'jpeg' | 'webp' | 'ico';
  /** Where the logo was found. */
  source: 'apple-touch-icon' | 'icon' | 'og:image';
  /** Set once downloaded: the file name beside brand-kit.json. */
  file?: string;
}

export interface BrandKit {
  url: string;
  name: string | null;
  colors: BrandColor[];
  fonts: BrandFonts;
  logo: BrandLogo | null;
}
