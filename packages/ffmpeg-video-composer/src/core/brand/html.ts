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

type Attributes = Record<string, string>;

/** Inline CSS kept from a page: enough for any real stylesheet in a <style>, bounded for hostile ones. */
const MAX_INLINE_CSS = 512 * 1024;
const MAX_TITLE = 1000;

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
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

    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '>') return i;
  }

  return -1;
}

/** Attributes of the tag text between a tag name's end and its closing `>`. One pass, no backtracking. */
function attributes(html: string, from: number, to: number): Attributes {
  const out: Attributes = {};
  let i = from;

  while (i < to) {
    while (i < to && (WHITESPACE.has(html[i]) || html[i] === '/')) i++;

    const nameStart = i;

    while (i < to && !WHITESPACE.has(html[i]) && html[i] !== '=' && html[i] !== '/') i++;

    const name = asciiLower(html.slice(nameStart, i));

    while (i < to && WHITESPACE.has(html[i])) i++;

    if (html[i] !== '=') {
      if (name && i === nameStart) i++;
      if (name) out[name] ??= '';
      continue;
    }

    i++;

    while (i < to && WHITESPACE.has(html[i])) i++;

    const quote = html[i] === '"' || html[i] === "'" ? html[i] : '';
    let value = '';

    if (quote) {
      const close = html.indexOf(quote, i + 1);
      const end = close === -1 || close > to ? to : close;

      value = html.slice(i + 1, end);
      i = end + 1;
    }

    if (!quote) {
      const start = i;

      while (i < to && !WHITESPACE.has(html[i])) i++;
      value = html.slice(start, i);
    }

    if (name) out[name] ??= value;
  }

  return out;
}

interface Head {
  metas: Attributes[];
  links: Attributes[];
  title: string | null;
  inlineCss: string;
}

function walkHead(html: string): Head {
  const lower = asciiLower(html);
  const headEnds = [lower.indexOf('</head'), lower.indexOf('<body')].filter((index) => index !== -1);
  const limit = headEnds.length > 0 ? Math.min(...headEnds) : html.length;
  const head: Head = { metas: [], links: [], title: null, inlineCss: '' };
  const css: string[] = [];
  let cssLength = 0;
  let pos = 0;

  while (pos < limit) {
    const lt = lower.indexOf('<', pos);

    if (lt === -1 || lt >= limit) break;

    if (lower.startsWith('<!--', lt)) {
      const close = lower.indexOf('-->', lt + 4);

      if (close === -1) break;
      pos = close + 3;
      continue;
    }

    let nameEnd = lt + 1;

    while (nameEnd < limit && lower[nameEnd] >= 'a' && lower[nameEnd] <= 'z') nameEnd++;

    const name = lower.slice(lt + 1, nameEnd);

    if (name !== 'meta' && name !== 'link' && name !== 'title' && name !== 'style') {
      pos = lt + 1;
      continue;
    }

    const end = tagEnd(html, nameEnd);

    if (end === -1) break;

    pos = end + 1;

    if (name === 'meta') head.metas.push(attributes(html, nameEnd, end));
    if (name === 'link') head.links.push(attributes(html, nameEnd, end));

    if (name === 'title' || name === 'style') {
      const close = lower.indexOf(`</${name}`, pos);
      const stop = close === -1 ? html.length : close;

      if (name === 'title' && head.title === null && close !== -1)
        head.title = html.slice(pos, Math.min(stop, pos + MAX_TITLE));

      if (name === 'style' && cssLength < MAX_INLINE_CSS) {
        const text = html.slice(pos, Math.min(stop, pos + MAX_INLINE_CSS - cssLength));

        css.push(text);
        cssLength += text.length + 1;
      }

      pos = stop;
    }
  }

  head.inlineCss = css.join('\n');

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
  return (link.rel ?? '').toLowerCase().split(/\s+/);
}

function logoFrom(links: Attributes[], metas: Attributes[], base: string): BrandLogo | null {
  const candidates: { href: string | undefined; source: BrandLogo['source'] }[] = [
    { href: links.find((l) => rels(l).includes('apple-touch-icon'))?.href, source: 'apple-touch-icon' },
    {
      href: links.find((l) => rels(l).includes('icon') && !/\.ico(?:[?#]|$)/i.test(l.href ?? ''))?.href,
      source: 'icon',
    },
    { href: metas.find((m) => m.property?.toLowerCase() === 'og:image')?.content, source: 'og:image' },
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

export function parseBrandPage(html: string, pageUrl: string): BrandPage {
  const { metas, links, title: rawTitle, inlineCss } = walkHead(html);
  const sheets = links.filter((l) => rels(l).includes('stylesheet') && l.href);
  const google = sheets.filter((l) => /fonts\.googleapis\.com/i.test(l.href));
  const siteName = metas.find((m) => {
    const key = m.property?.toLowerCase();

    return key === 'og:site_name' || m.name?.toLowerCase() === 'application-name';
  })?.content;
  const title = rawTitle?.split(/\s[|–—-]\s/)[0]?.trim();
  const themeColor = metas.find((m) => m.name?.toLowerCase() === 'theme-color')?.content;

  return {
    name: siteName?.trim() || title || null,
    themeColor: themeColor ? normalizeColor(themeColor) : null,
    stylesheets: sheets
      .filter((l) => !google.includes(l))
      .map((l) => resolve(l.href, pageUrl))
      .filter((url): url is string => url !== null),
    inlineCss,
    googleFamilies: google.flatMap((l) => googleFamilies(l.href)),
    logo: logoFrom(links, metas, pageUrl),
  };
}
