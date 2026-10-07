// Curated TTF font registry shared by the engine (font validation + drawtext resolution) and the
// creative-kit catalog/editor. The .ttf files are NOT bundled in the package — they are fetched on
// demand from the asset source (see `asset-source.ts`); this registry only maps a stable `id` to its
// file name and display label.
export interface FontEntry {
  id: string;
  label: string;
  file: string;
  cssFamily: string;
}

export const FONTS: FontEntry[] = [
  { id: 'rubik', label: 'Rubik', file: 'Rubik.ttf', cssFamily: 'Rubik' },
  { id: 'oswald', label: 'Oswald', file: 'Oswald.ttf', cssFamily: 'Oswald' },
  { id: 'bebas', label: 'Bebas Neue', file: 'BebasNeue.ttf', cssFamily: 'Bebas Neue' },
  { id: 'playfair', label: 'Playfair Display', file: 'PlayfairDisplay.ttf', cssFamily: 'Playfair Display' },
  { id: 'pacifico', label: 'Pacifico', file: 'Pacifico.ttf', cssFamily: 'Pacifico' },
  { id: 'mono', label: 'Roboto Mono', file: 'RobotoMono.ttf', cssFamily: 'Roboto Mono' },
  { id: 'anton', label: 'Anton', file: 'Anton.ttf', cssFamily: 'Anton' },
  { id: 'archivo-black', label: 'Archivo Black', file: 'ArchivoBlack.ttf', cssFamily: 'Archivo Black' },
  { id: 'bungee', label: 'Bungee', file: 'Bungee.ttf', cssFamily: 'Bungee' },
  { id: 'abril-fatface', label: 'Abril Fatface', file: 'AbrilFatface.ttf', cssFamily: 'Abril Fatface' },
  { id: 'righteous', label: 'Righteous', file: 'Righteous.ttf', cssFamily: 'Righteous' },
  { id: 'lobster', label: 'Lobster', file: 'Lobster.ttf', cssFamily: 'Lobster' },
  // Right-to-left scripts (OFL, library/fonts/NotoSans-OFL.txt). Arabic/Hebrew letters only — pair with
  // a Latin font for mixed copy. Drawn a line at a time so letters join (core/text-scripts.ts).
  { id: 'noto-arabic', label: 'Noto Sans Arabic', file: 'NotoSansArabic.ttf', cssFamily: 'Noto Sans Arabic' },
  { id: 'noto-hebrew', label: 'Noto Sans Hebrew', file: 'NotoSansHebrew.ttf', cssFamily: 'Noto Sans Hebrew' },
];

export function findFont(id: string): FontEntry | undefined {
  return FONTS.find((f) => f.id === id);
}

// Look up a catalog font by its .ttf file name (used when staging fonts referenced by file).
export function findFontByFile(file: string): FontEntry | undefined {
  return FONTS.find((f) => f.file === file);
}

export const DEFAULT_FONT_ID = 'rubik';

// ---------------------------------------------------------------------------
// resolved fonts — a font named by family rather than by bundled file
// ---------------------------------------------------------------------------
//
// The curated registry above covers the fonts LeClap ships. A `FontRef` names any other family and
// is resolved on demand (see `google-fonts.ts`). It is deliberately an OBJECT so it stays
// structurally distinct from a registry id: a typo in `"bebas"` remains a local validator error
// instead of turning into a network round-trip that fails mid-render.
export interface FontRef {
  family: string;
  /** 100–900 in steps of 100. Defaults to 400. */
  weight?: number;
  style?: 'normal' | 'italic';
}

/** A font as authored: a registry id, a raw `.ttf` filename, or a resolved family. */
export type FontInput = string | FontRef;

export const DEFAULT_FONT_WEIGHT = 400;

// Takes `unknown` because descriptors are JSON: a `"font": null` must read as "not a ref", not throw.
export function isFontRef(font: unknown): font is FontRef {
  return typeof font === 'object' && font !== null && 'family' in font && typeof font.family === 'string';
}

// Where a descriptor names a font by family, as paths (`sections[1].titleCard.headlineStyle.font`). A
// platform that cannot resolve one (the browser) refuses the template with these BEFORE rendering,
// rather than failing once earlier sections have already been encoded.
export function fontRefPaths(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) => fontRefPaths(item, `${path}[${index}]`));
  }

  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]: [string, unknown]) => {
    const childPath = path ? `${path}.${key}` : key;

    return key === 'font' && isFontRef(child) ? [childPath] : fontRefPaths(child, childPath);
  });
}

// The staged filename for a ref. This is a CACHE KEY ONLY — it is written, never parsed back.
// Decoding a slug into a family name is lossy exactly where it matters ("Press Start 2P" →
// `press-start-2p` → ?), which is the guess that made the old filename-derived lookup wrong.
export function fontRefSlug(ref: FontRef): string {
  const family = ref.family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const weight = ref.weight ?? DEFAULT_FONT_WEIGHT;
  const italic = ref.style === 'italic' ? '-italic' : '';

  return `google-${family}-${weight}${italic}.ttf`;
}
