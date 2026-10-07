// Shared building blocks of the music-cover shapes (gen-music-covers.ts): layer parameter readers, the seeded
// PRNG that keeps scattered shapes deterministic, and small SVG fragments reused across scenes.
import { PALETTE, type Layer } from './music-covers-types.ts';

export const SIZE = 512;
export const C = PALETTE;

export interface Ctx {
  rnd: () => number;
  uid: (prefix: string) => string;
}

export type Shape = (l: Layer, ctx: Ctx) => string;

export function num(l: Layer, key: string, fallback: number): number {
  const value = l[key];

  return typeof value === 'number' ? value : fallback;
}

export function str(l: Layer, key: string, fallback: string): string {
  const value = l[key];

  return typeof value === 'string' ? value : fallback;
}

export function list<T extends number | string>(l: Layer, key: string): T[] {
  const value = l[key];

  return Array.isArray(value) ? (value as T[]) : [];
}

export function seeded(seed: number): () => number {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(text: string): number {
  let h = 2166136261;

  for (const char of text) h = Math.imul(h ^ (char.codePointAt(0) ?? 0), 16777619);

  return h >>> 0;
}

export const f = (n: number) => Number(n.toFixed(1));

export function radial(id: string, color: string, opacity: number): string {
  return `<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
}

export function glowCircle(ctx: Ctx, r: number, color: string, opacity: number): string {
  const id = ctx.uid('glow');

  return `${radial(id, color, opacity)}<circle r="${r}" fill="url(#${id})"/>`;
}

export function steam(x: number, y: number, color: string, gap = 20): string {
  return [-gap / 2, gap / 2]
    .map(
      (dx, i) =>
        `<path d="M${x + dx} ${y} c-9 -11 9 -19 0 -30 c-9 -11 9 -19 0 -30" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity="${0.75 - i * 0.2}"/>`
    )
    .join('');
}

export function arc(r: number, from: number, to: number): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const [x0, y0] = [r * Math.cos(rad(from)), r * Math.sin(rad(from))];
  const [x1, y1] = [r * Math.cos(rad(to)), r * Math.sin(rad(to))];

  return `M${f(x0)} ${f(y0)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`;
}

export const SPARKLE = 'M0 -10 Q1.6 -1.6 10 0 Q1.6 1.6 0 10 Q-1.6 1.6 -10 0 Q-1.6 -1.6 0 -10Z';
export const LEAF = 'M0 -16 C12 -6 10 8 0 16 C-10 8 -12 -6 0 -16Z';
export const HEART = 'M0 6 C-14 -4 -8 -16 0 -9 C8 -16 14 -4 0 6Z';

export function vinylDisc(r: number, label: string): string {
  const grooves = [0.92, 0.82, 0.72, 0.62, 0.52]
    .map((k) => `<circle r="${f(r * k)}" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.6"/>`)
    .join('');
  const sheen = [
    [-75, -20],
    [105, 160],
  ]
    .map(
      ([a, b]) =>
        `<path d="${arc(r * 0.74, a, b)}" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="${f(r * 0.3)}"/>`
    )
    .join('');

  return `<circle r="${r}" fill="${C.ink}"/>${grooves}${sheen}<circle r="${f(r * 0.32)}" fill="${label}"/><circle r="${f(r * 0.05)}" fill="${C.cream}"/>`;
}

export function note(x: number, y: number, size: number, color: string, beamed: boolean): string {
  const head = (dx: number) =>
    `<ellipse cx="${dx}" cy="0" rx="11" ry="8" transform="rotate(-20 ${dx} 0)"/><rect x="${dx + 7}" y="-46" width="4" height="46"/>`;
  const body = beamed
    ? `${head(0)}${head(32)}<path d="M7 -46 L43 -54 L43 -45 L7 -37Z"/>`
    : `${head(0)}<path d="M11 -46 c10 6 20 14 10 30 c4 -12 -2 -19 -10 -21Z"/>`;

  return `<g transform="translate(${x} ${y}) scale(${size})" fill="${color}">${body}</g>`;
}
