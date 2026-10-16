// packages/ffmpeg-video-composer/src/core/brand/html.ts
// What a page's <head> says about its brand, by walking its tags (no DOM): its name, theme colour, own
// stylesheets, inline CSS, Google Fonts families and the best logo it links. URLs resolve against the page.
// The HTML is untrusted: the walk is a single indexOf-driven pass, so hostile input costs linear time.

import { normalizeColor } from './css';
import type { BrandLogo } from './types';

export interface BrandPage {
  name: string | null;
  themeColor: string | null;
  stylesheets: string[];
  inlineCss: string;
  googleFamilies: string[];
  logo: BrandLogo | null;
}

type Attributes = Partial<Record<string, string>>;

/** Inline CSS kept from a page: enough for any real stylesheet in a <style>, bounded for hostile ones. */
const MAX_INLINE_CSS = 512 * 1024;
const MAX_TITLE = 1000;

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode the common entities in one bounded pass; anything unknown or out of range is left as written. */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;

  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,4});/gi, (whole, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole;

    const code =
      body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);

    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

function attr(attrs: Attributes, key: string): string {
  return attrs[key] ?? '';
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && WHITESPACE.has(ch);
}

/** Index of the `>` closing the tag opened at `from`, skipping quoted attribute values; -1 if unterminated. */
function tagEnd(html: string, from: number): number {
  let quote = '';

  for (let i = from; i < html.length; i++) {
    const ch = html[i];

    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '>') return i;

    if (ch === '"' || ch === "'") quote = ch;
  }

  return -1;
}

function skipWhile(html: string, from: number, to: number, skip: (ch: string) => boolean): number {
  let i = from;

  while (i < to && skip(html[i])) i++;

  return i;
}

/** The attribute value starting at `from` (after `=`), and where the next attribute begins. */
function attributeValue(html: string, from: number, to: number): { value: string; next: number } {
  const first = html[from];

  if (first === '"' || first === "'") {
    // The closing quote is searched for within the tag only: an unmatched quote ends the value at the tag's end.
    const end = skipWhile(html, from + 1, to, (ch) => ch !== first);

    return { value: decodeEntities(html.slice(from + 1, end)), next: end + 1 };
  }

  const end = skipWhile(html, from, to, (ch) => !isSpace(ch));

  return { value: decodeEntities(html.slice(from, end)), next: end };
}

/** Attributes of the tag text between a tag name's end and its closing `>`. One pass, no backtracking. */
function attributes(html: string, from: number, to: number): Attributes {
  const out: Attributes = {};
  let i = from;

  while (i < to) {
    i = skipWhile(html, i, to, (ch) => isSpace(ch) || ch === '/');

    const nameEnd = skipWhile(html, i, to, (ch) => !isSpace(ch) && ch !== '=' && ch !== '/');
    const name = asciiLower(html.slice(i, nameEnd));

    i = skipWhile(html, nameEnd, to, isSpace);

    if (html[i] !== '=') {
      if (name) out[name] ??= '';
      continue;
    }

    const parsed = attributeValue(html, skipWhile(html, i + 1, to, isSpace), to);

    if (name) out[name] ??= parsed.value;
    i = parsed.next;
  }

  return out;
}

interface Head {
  metas: Attributes[];
  links: Attributes[];
  title: string | null;
  inlineCss: string;
}

function tagName(lower: string, lt: number, limit: number): { name: string; end: number } {
  let end = lt + 1;

  while (end < limit && lower[end] >= 'a' && lower[end] <= 'z') end++;

  return { name: lower.slice(lt + 1, end), end };
}

interface Walk {
  html: string;
  lower: string;
  limit: number;
  pos: number;
  head: Head;
  css: string[];
  cssLength: number;
}

/** Take the raw text of a <title> or <style> that opens at `walk.pos`, up to its closing tag. */
function takeRawText(walk: Walk, name: 'title' | 'style' | 'script'): void {
  const close = walk.lower.indexOf(`</${name}`, walk.pos);
  const stop = close === -1 ? walk.html.length : close;

  if (name === 'title' && walk.head.title === null && close !== -1) {
    walk.head.title = decodeEntities(walk.html.slice(walk.pos, Math.min(stop, walk.pos + MAX_TITLE)));
  }

  if (name === 'style') {
    const room = Math.max(0, MAX_INLINE_CSS - walk.cssLength);
    const text = walk.html.slice(walk.pos, Math.min(stop, walk.pos + room));

    walk.css.push(text);
    walk.cssLength += text.length + 1;
  }

  walk.pos = stop;
}

/** Handle the tag opening at `lt`. Returns false when the rest of the head cannot be read. */
function step(walk: Walk, lt: number): boolean {
  if (walk.lower.startsWith('<!--', lt)) {
    const close = walk.lower.indexOf('-->', lt + 4);

    walk.pos = close + 3;

    return close !== -1;
  }

  if (walk.lower.startsWith('</head', lt) || walk.lower.startsWith('<body', lt)) return false;

  const { name, end: nameEnd } = tagName(walk.lower, lt, walk.limit);

  walk.pos = lt + 1;

  if (!['meta', 'link', 'title', 'style', 'script'].includes(name)) return true;

  const end = tagEnd(walk.html, nameEnd);

  if (end === -1) return false;

  walk.pos = end + 1;

  if (name === 'meta') walk.head.metas.push(attributes(walk.html, nameEnd, end));

  if (name === 'link') walk.head.links.push(attributes(walk.html, nameEnd, end));

  if (name === 'title' || name === 'style' || name === 'script') takeRawText(walk, name);

  return true;
}

function walkHead(html: string): Head {
  const lower = asciiLower(html);
  const head: Head = { metas: [], links: [], title: null, inlineCss: '' };
  const walk: Walk = { html, lower, limit: lower.length, pos: 0, head, css: [], cssLength: 0 };

  while (walk.pos < walk.limit) {
    const lt = lower.indexOf('<', walk.pos);

    if (lt === -1 || lt >= walk.limit || !step(walk, lt)) break;
  }

  head.inlineCss = walk.css.join('\n');

  return head;
}

function resolve(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function typeOf(url: string): BrandLogo['type'] | null {
  const ext = /\.(png|svg|jpe?g|webp|ico)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();

  if (ext === undefined) return null;

  return ext === 'jpg' ? 'jpeg' : (ext as BrandLogo['type']);
}

function rels(link: Attributes): string[] {
  return attr(link, 'rel').toLowerCase().split(/\s+/);
}

/** Apple's touch icon is 180 px when a link gives no size; any other icon without one counts as smallest. */
const TOUCH_ICON_SIZE = 180;

interface IconLink {
  href: string;
  source: 'apple-touch-icon' | 'icon';
  size: number;
  explicit: boolean;
}

function sizeOf(sizes: string): number {
  let largest = 0;

  for (const match of sizes.slice(0, 200).matchAll(/(\d{1,5})x(\d{1,5})/gi)) {
    largest = Math.max(largest, Math.min(Number(match[1]), Number(match[2])));
  }

  return largest;
}

function iconLink(link: Attributes): IconLink | null {
  const kinds = rels(link);
  const href = attr(link, 'href');
  const size = sizeOf(attr(link, 'sizes'));

  if (kinds.some((rel) => rel.startsWith('apple-touch-icon'))) {
    return { href, source: 'apple-touch-icon', size: size || TOUCH_ICON_SIZE, explicit: size > 0 };
  }

  if (!kinds.includes('icon') || /\.ico(?:[?#]|$)/i.test(href)) return null;

  return { href, source: 'icon', size, explicit: size > 0 };
}

/** SVG and ICO need a conversion before they can be an image layer: FFmpeg reads SVG only with librsvg. */
function isRaster(href: string): boolean {
  return !/\.(svg|ico)(?:[?#]|$)/i.test(href);
}

/**
 * The largest usable icon (a raster beats a vector, a stated size beats an implied one, a touch icon beats a
 * favicon), else og:image.
 */
function logoFrom(links: Attributes[], metas: Attributes[], base: string): BrandLogo | null {
  const icons = links
    .map(iconLink)
    .filter((icon): icon is IconLink => icon !== null)
    .sort(
      (a, b) =>
        Number(isRaster(b.href)) - Number(isRaster(a.href)) ||
        b.size - a.size ||
        Number(b.explicit) - Number(a.explicit) ||
        Number(b.source === 'apple-touch-icon') - Number(a.source === 'apple-touch-icon')
    );
  const candidates: { href: string; source: BrandLogo['source'] }[] = [
    ...icons,
    ...metas
      .filter((m) => ogKey(m) === 'og:image')
      .map((m) => ({ href: attr(m, 'content'), source: 'og:image' as const })),
  ];

  for (const { href, source } of candidates) {
    const url = href ? resolve(href, base) : null;
    const type = url ? typeOf(url) : null;

    if (url && type) return { url, type, source };
  }

  return null;
}

function googleFamilies(href: string): string[] {
  const url = resolve(href, 'https://fonts.googleapis.com/');

  if (!url) return [];

  return new URL(url).searchParams.getAll('family').map((f) => f.split(':')[0].replace(/\+/g, ' ').trim());
}

// A site-wide sheet (layout, global, main, app…) holds the tokens; a colour-scheme or print variant holds a
// recolouring of them. Bundlers name the rest by hash, in no useful order.
const SITE_WIDE_SHEET =
  /(?:^|[._-])(global|globals|layout|main|app|index|style|styles|theme|base|site|common|root)(?:[._-]|$)/i;
const VARIANT_SHEET =
  /(?:^|[._-])(dark|high[_-]?contrast|colorblind|tritanopia|deuteranopia|protanopia|print|rtl)(?:[._-]|$)/i;

function sheetRank(link: Attributes, url: string): number {
  const file = new URL(url).pathname.split('/').at(-1) ?? '';

  if (VARIANT_SHEET.test(file) || /print|dark/i.test(attr(link, 'media'))) return 2;

  return SITE_WIDE_SHEET.test(file) ? 0 : 1;
}

/** The page's own stylesheets, resolved, site-wide sheets first and colour-scheme variants last. */
function ownStylesheets(sheets: Attributes[], pageUrl: string): string[] {
  return sheets
    .map((link) => ({ link, url: resolve(attr(link, 'href'), pageUrl) }))
    .filter((sheet): sheet is { link: Attributes; url: string } => sheet.url !== null)
    .map((sheet) => ({ url: sheet.url, rank: sheetRank(sheet.link, sheet.url) }))
    .sort((a, b) => a.rank - b.rank)
    .map((sheet) => sheet.url);
}

/** An Open Graph tag's key: pages write it as property= (the spec) or name= (common). */
function ogKey(meta: Attributes): string {
  return (attr(meta, 'property') || attr(meta, 'name')).toLowerCase();
}

function metaContent(metas: Attributes[], keys: [string, string]): string {
  const meta = metas.find((m) => attr(m, keys[0]).toLowerCase() === keys[1]);

  return meta ? attr(meta, 'content') : '';
}

export function parseBrandPage(html: string, pageUrl: string): BrandPage {
  const { metas, links, title: rawTitle, inlineCss } = walkHead(html);
  const sheets = links.filter(
    (l) => rels(l).includes('stylesheet') && !rels(l).includes('alternate') && attr(l, 'href')
  );
  const google = sheets.filter((l) => /fonts\.googleapis\.com/i.test(attr(l, 'href')));
  const siteName = [
    attr(metas.find((m) => ogKey(m) === 'og:site_name') ?? {}, 'content'),
    metaContent(metas, ['name', 'application-name']),
  ]
    .map((value) => value.trim())
    .find((value) => value !== '');
  const title = rawTitle?.split(/\s[|–—-]\s|:\s/)[0].trim();
  const themeColor = metaContent(metas, ['name', 'theme-color']);

  return {
    name: siteName ?? (title === undefined || title === '' ? null : title),
    themeColor: themeColor ? normalizeColor(themeColor) : null,
    stylesheets: ownStylesheets(
      sheets.filter((l) => !google.includes(l)),
      pageUrl
    ),
    inlineCss,
    googleFamilies: google.flatMap((l) => googleFamilies(attr(l, 'href'))),
    logo: logoFrom(links, metas, pageUrl),
  };
}
