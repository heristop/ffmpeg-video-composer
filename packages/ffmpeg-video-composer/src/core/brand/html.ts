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
    const close = html.indexOf(first, from + 1);
    const end = close === -1 || close > to ? to : close;

    return { value: html.slice(from + 1, end), next: end + 1 };
  }

  const end = skipWhile(html, from, to, (ch) => !isSpace(ch));

  return { value: html.slice(from, end), next: end };
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

/** Where the head ends: `</head` or `<body`, whichever comes first. */
function headLimit(lower: string): number {
  const ends = [lower.indexOf('</head'), lower.indexOf('<body')].filter((index) => index !== -1);

  return ends.length > 0 ? Math.min(...ends) : lower.length;
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
function takeRawText(walk: Walk, name: 'title' | 'style'): void {
  const close = walk.lower.indexOf(`</${name}`, walk.pos);
  const stop = close === -1 ? walk.html.length : close;

  if (name === 'title' && walk.head.title === null && close !== -1) {
    walk.head.title = walk.html.slice(walk.pos, Math.min(stop, walk.pos + MAX_TITLE));
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

  const { name, end: nameEnd } = tagName(walk.lower, lt, walk.limit);

  walk.pos = lt + 1;

  if (name !== 'meta' && name !== 'link' && name !== 'title' && name !== 'style') return true;

  const end = tagEnd(walk.html, nameEnd);

  if (end === -1) return false;

  walk.pos = end + 1;

  if (name === 'meta') walk.head.metas.push(attributes(walk.html, nameEnd, end));

  if (name === 'link') walk.head.links.push(attributes(walk.html, nameEnd, end));

  if (name === 'title' || name === 'style') takeRawText(walk, name);

  return true;
}

function walkHead(html: string): Head {
  const lower = asciiLower(html);
  const head: Head = { metas: [], links: [], title: null, inlineCss: '' };
  const walk: Walk = { html, lower, limit: headLimit(lower), pos: 0, head, css: [], cssLength: 0 };

  while (walk.pos < walk.limit) {
    const lt = lower.indexOf('<', walk.pos);

    if (lt === -1 || lt >= walk.limit || !step(walk, lt)) break;
  }

  head.inlineCss = walk.css.join('\n');

  return head;
}

function resolve(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
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

function logoFrom(links: Attributes[], metas: Attributes[], base: string): BrandLogo | null {
  const candidates: { href: string; source: BrandLogo['source'] }[] = [
    {
      href: attr(links.find((l) => rels(l).includes('apple-touch-icon')) ?? {}, 'href'),
      source: 'apple-touch-icon',
    },
    {
      href: attr(
        links.find((l) => rels(l).includes('icon') && !/\.ico(?:[?#]|$)/i.test(attr(l, 'href'))) ?? {},
        'href'
      ),
      source: 'icon',
    },
    {
      href: attr(metas.find((m) => attr(m, 'property').toLowerCase() === 'og:image') ?? {}, 'content'),
      source: 'og:image',
    },
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

function metaContent(metas: Attributes[], keys: [string, string]): string {
  const meta = metas.find((m) => attr(m, keys[0]).toLowerCase() === keys[1]);

  return meta ? attr(meta, 'content') : '';
}

export function parseBrandPage(html: string, pageUrl: string): BrandPage {
  const { metas, links, title: rawTitle, inlineCss } = walkHead(html);
  const sheets = links.filter((l) => rels(l).includes('stylesheet') && attr(l, 'href'));
  const google = sheets.filter((l) => /fonts\.googleapis\.com/i.test(attr(l, 'href')));
  const siteName = [metaContent(metas, ['property', 'og:site_name']), metaContent(metas, ['name', 'application-name'])]
    .map((value) => value.trim())
    .find((value) => value !== '');
  const title = rawTitle?.split(/\s[|–—-]\s/)[0].trim();
  const themeColor = metaContent(metas, ['name', 'theme-color']);

  return {
    name: siteName ?? (title === undefined || title === '' ? null : title),
    themeColor: themeColor ? normalizeColor(themeColor) : null,
    stylesheets: sheets
      .filter((l) => !google.includes(l))
      .map((l) => resolve(attr(l, 'href'), pageUrl))
      .filter((url): url is string => url !== null),
    inlineCss,
    googleFamilies: google.flatMap((l) => googleFamilies(attr(l, 'href'))),
    logo: logoFrom(links, metas, pageUrl),
  };
}
