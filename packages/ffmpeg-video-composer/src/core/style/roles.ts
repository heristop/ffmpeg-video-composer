// Role assignment: turn an extracted palette into the seven theme colour tokens.
//   bg      the dominant low-chroma, large-area colour
//   fg      the cluster with the highest contrast to bg, moved to WCAG AA (4.5:1) when short
//   accent  the most saturated distinct hue with enough area (≥ 3:1 on bg, a graphic/large-text ratio)
//   accent2 a second hue well away from accent, or a lightness step of accent
//   muted   a mid-contrast neutral for secondary copy (still ≥ 4.5:1)
//   surface bg nudged slightly away from black/white
//   brand   accent, unless a colour carries clearly more saturated area

import { relativeLuminance } from '../color-contrast';
import type { ThemeColorName } from '../theme/themes';
import { AA_LARGE, AA_TEXT, enforceContrast, ratioOf } from './contrast';
import { deltaE, hexToRgb, hueDistance, labToHex, type Lab } from './oklab';
import type { PaletteCluster, RoleColor, ThemeRoles } from './types';

const NEUTRAL_CHROMA = 0.06;
const ACCENT_MIN_CHROMA = 0.05;
const ACCENT_MIN_SHARE = 0.01;
const ACCENT2_MIN_SHARE = 0.004;
const ACCENT2_MIN_HUE = 30;
const DISTINCT_FROM_BG = 0.08;
const SURFACE_STEP = 0.05;

export interface RoleResult {
  roles: ThemeRoles;
  /** Which palette cluster (index) each role came from, when it came from one. */
  origins: Partial<Record<ThemeColorName, number>>;
}

function role(hex: string, source: RoleColor['source'], share: number): RoleColor {
  return { hex, source, share };
}

function maxBy<T>(items: readonly T[], score: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;

  for (const item of items) {
    const s = score(item);

    if (s > bestScore) {
      best = item;
      bestScore = s;
    }
  }

  return best;
}

function pickBackground(palette: readonly PaletteCluster[]): PaletteCluster {
  // A strongly coloured cluster can still be the canvas when it dominates; it just needs more area.
  return maxBy(palette, (c) => c.share * (c.chroma < NEUTRAL_CHROMA ? 1 : 0.35)) ?? palette[0];
}

function isDark(bgHex: string): boolean {
  return relativeLuminance(hexToRgb(bgHex)) < 0.18;
}

function enforced(cluster: PaletteCluster, bgHex: string, min: number): RoleColor {
  const result = enforceContrast(cluster.lab, hexToRgb(bgHex), min);

  return role(result.hex, result.adjusted ? 'adjusted' : 'extracted', cluster.share);
}

function derivedFrom(lab: Lab, bgHex: string, min: number): RoleColor {
  return role(enforceContrast(lab, hexToRgb(bgHex), min).hex, 'derived', 0);
}

interface Picks {
  bg: PaletteCluster;
  others: PaletteCluster[];
}

function pickAccent({ bg, others }: Picks): PaletteCluster | undefined {
  const distinct = others.filter((c) => deltaE(c.lab, bg.lab) >= DISTINCT_FROM_BG);
  const vivid = distinct.filter((c) => c.chroma >= ACCENT_MIN_CHROMA && c.share >= ACCENT_MIN_SHARE);

  return maxBy(vivid, (c) => c.chroma);
}

function pickAccent2(picks: Picks, accent: PaletteCluster | undefined): PaletteCluster | undefined {
  if (!accent) return undefined;

  const candidates = picks.others.filter(
    (c) =>
      c !== accent &&
      c.chroma >= ACCENT_MIN_CHROMA &&
      c.share >= ACCENT2_MIN_SHARE &&
      hueDistance(c.hue, accent.hue) >= ACCENT2_MIN_HUE
  );

  return maxBy(candidates, (c) => c.chroma);
}

function pickBrand(picks: Picks, accent: PaletteCluster | undefined): PaletteCluster | undefined {
  const strongest = maxBy(
    picks.others.filter((c) => c.chroma >= 0.08),
    (c) => c.chroma * c.share
  );

  if (!accent || !strongest || strongest === accent) return accent;

  return strongest.chroma * strongest.share >= 1.5 * accent.chroma * accent.share ? strongest : accent;
}

function pickMuted(picks: Picks, fg: PaletteCluster | undefined, fgRatio: number): PaletteCluster | undefined {
  const bgRgb = hexToRgb(picks.bg.hex);
  const neutrals = picks.others.filter((c) => c !== fg && c.chroma < NEUTRAL_CHROMA);
  const mid = neutrals.filter((c) => {
    const ratio = ratioOf(c.hex, bgRgb);

    return ratio >= AA_LARGE && ratio < fgRatio * 0.85;
  });

  return maxBy(mid, (c) => c.share);
}

function surfaceOf(picks: Picks): RoleColor {
  const dark = isDark(picks.bg.hex);
  const step = dark ? SURFACE_STEP : -SURFACE_STEP;
  const near = picks.others.find((c) => {
    const d = c.lab.l - picks.bg.lab.l;

    return (
      c.chroma < NEUTRAL_CHROMA * 1.5 && Math.sign(d) === Math.sign(step) && Math.abs(d) <= 0.1 && Math.abs(d) >= 0.02
    );
  });

  if (near) return role(near.hex, 'extracted', near.share);

  return role(labToHex({ ...picks.bg.lab, l: picks.bg.lab.l + step }), 'derived', 0);
}

function fgOf(picks: Picks): { color: RoleColor; cluster?: PaletteCluster } {
  const bgRgb = hexToRgb(picks.bg.hex);
  const cluster = maxBy(picks.others, (c) => ratioOf(c.hex, bgRgb));

  if (!cluster) {
    return {
      color: derivedFrom(isDark(picks.bg.hex) ? { l: 1, a: 0, b: 0 } : { l: 0, a: 0, b: 0 }, picks.bg.hex, AA_TEXT),
    };
  }

  return { color: enforced(cluster, picks.bg.hex, AA_TEXT), cluster };
}

function mutedOf(picks: Picks, fg: { color: RoleColor; cluster?: PaletteCluster }): RoleColor {
  const bgRgb = hexToRgb(picks.bg.hex);
  const cluster = pickMuted(picks, fg.cluster, ratioOf(fg.color.hex, bgRgb));

  if (cluster) return enforced(cluster, picks.bg.hex, AA_TEXT);

  // Half-way from bg to fg in OKLab, then pushed out just far enough for body-text contrast.
  const fgLab = fg.cluster?.lab ?? picks.bg.lab;
  const mix: Lab = {
    l: (picks.bg.lab.l + fgLab.l) / 2,
    a: (picks.bg.lab.a + fgLab.a) / 2,
    b: (picks.bg.lab.b + fgLab.b) / 2,
  };

  return derivedFrom(mix, picks.bg.hex, AA_TEXT);
}

function accentOf(picks: Picks, cluster: PaletteCluster | undefined, fg: RoleColor): RoleColor {
  if (cluster) return enforced(cluster, picks.bg.hex, AA_LARGE);

  return role(fg.hex, 'derived', 0);
}

function accent2Of(
  picks: Picks,
  cluster: PaletteCluster | undefined,
  accent: PaletteCluster | undefined,
  fallback: RoleColor
): RoleColor {
  if (cluster) return enforced(cluster, picks.bg.hex, AA_LARGE);

  if (!accent) return role(fallback.hex, 'derived', 0);

  // A lightness step of the accent: the same hue family, visibly a second colour.
  const step = isDark(picks.bg.hex) ? 0.14 : -0.14;

  return derivedFrom({ ...accent.lab, l: Math.min(0.97, Math.max(0.05, accent.lab.l + step)) }, picks.bg.hex, AA_LARGE);
}

function indexIn(palette: readonly PaletteCluster[], c: PaletteCluster | undefined): number {
  return c ? palette.indexOf(c) : -1;
}

/** Assigns the seven theme roles from a palette (largest share first, as `extractPalette` returns it). */
export function assignRoles(palette: readonly PaletteCluster[]): RoleResult {
  const bg = pickBackground(palette);
  const picks: Picks = { bg, others: palette.filter((c) => c !== bg) };
  const fg = fgOf(picks);
  const accentCluster = pickAccent(picks);
  const accent = accentOf(picks, accentCluster, fg.color);
  const brandCluster = pickBrand(picks, accentCluster);
  const accent2Cluster = pickAccent2(picks, accentCluster);
  const roles: ThemeRoles = {
    bg: role(bg.hex, 'extracted', bg.share),
    fg: fg.color,
    muted: mutedOf(picks, fg),
    surface: surfaceOf(picks),
    brand: brandCluster && brandCluster !== accentCluster ? enforced(brandCluster, bg.hex, AA_LARGE) : accent,
    accent,
    accent2: accent2Of(picks, accent2Cluster, accentCluster, accent),
  };
  const entries: Array<[ThemeColorName, number]> = [
    ['bg', indexIn(palette, bg)],
    ['fg', indexIn(palette, fg.cluster)],
    ['accent', indexIn(palette, accentCluster)],
    ['accent2', indexIn(palette, accent2Cluster)],
    ['brand', indexIn(palette, brandCluster)],
  ];

  return { roles, origins: Object.fromEntries(entries.filter(([, i]) => i >= 0)) };
}
