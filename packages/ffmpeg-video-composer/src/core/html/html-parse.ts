// A small, forgiving HTML parser for HTML layers. It reads tags, attributes, text and entities into a
// plain tree and nothing more: no scripts run, no URL is resolved, raw-text elements (script, style…) keep
// no content. What survives into the render is decided by the sanitiser (html-sanitise.ts), not here.

import { decodeEntities, firstGroup } from './html-entities';

export interface HtmlElementNode {
  kind: 'element';
  tag: string;
  attrs: Partial<Record<string, string>>;
  children: HtmlNode[];
}

export interface HtmlTextNode {
  kind: 'text';
  text: string;
}

export type HtmlNode = HtmlElementNode | HtmlTextNode;

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'wbr',
]);
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title', 'iframe', 'noscript', 'xmp', 'noembed']);

/** Deeper elements are kept childless, so a hostile input cannot recurse without bound. */
const MAX_DEPTH = 48;

const TAG_OPEN = /^<([a-zA-Z][a-zA-Z0-9-]*)/;
const TAG_CLOSE = /^<\/([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/;
const ATTRIBUTE = /^\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/;

interface Cursor {
  source: string;
  at: number;
  root: HtmlElementNode;
  stack: HtmlElementNode[];
}

function current(cursor: Cursor): HtmlElementNode {
  return cursor.stack.at(-1) ?? cursor.root;
}

function appendText(cursor: Cursor, raw: string): void {
  if (raw === '') return;

  const parent = current(cursor);
  const last = parent.children.at(-1);
  const text = decodeEntities(raw);

  if (last?.kind === 'text') {
    last.text += text;

    return;
  }

  parent.children.push({ kind: 'text', text });
}

function readAttributes(cursor: Cursor): { attrs: Partial<Record<string, string>>; selfClosing: boolean } {
  const attrs: Partial<Record<string, string>> = {};

  for (;;) {
    const rest = cursor.source.slice(cursor.at);
    const end = /^\s*(\/?)>/.exec(rest);

    if (end) {
      cursor.at += end[0].length;

      return { attrs, selfClosing: end[1] === '/' };
    }

    const match = ATTRIBUTE.exec(rest);

    if (!match) {
      // Malformed attribute soup: skip a character, or stop at the end of the input.
      cursor.at += 1;

      if (cursor.at >= cursor.source.length) return { attrs, selfClosing: false };

      continue;
    }

    cursor.at += match[0].length;
    const name = match[1].toLowerCase();

    if (!Object.hasOwn(attrs, name)) attrs[name] = decodeEntities(firstGroup(match, 2));
  }
}

function skipRawText(cursor: Cursor, tag: string): void {
  const close = cursor.source.toLowerCase().indexOf(`</${tag}`, cursor.at);

  if (close === -1) {
    cursor.at = cursor.source.length;

    return;
  }

  const end = cursor.source.indexOf('>', close);
  cursor.at = end === -1 ? cursor.source.length : end + 1;
}

function openTag(cursor: Cursor, name: string): void {
  const tag = name.toLowerCase();
  cursor.at += name.length + 1;

  const { attrs, selfClosing } = readAttributes(cursor);
  const element: HtmlElementNode = { kind: 'element', tag, attrs, children: [] };

  current(cursor).children.push(element);

  if (RAW_TEXT_TAGS.has(tag)) {
    if (!selfClosing) skipRawText(cursor, tag);

    return;
  }

  if (selfClosing || VOID_TAGS.has(tag) || cursor.stack.length >= MAX_DEPTH) return;

  cursor.stack.push(element);
}

function closeTag(cursor: Cursor, name: string, length: number): void {
  cursor.at += length;
  const tag = name.toLowerCase();
  const index = cursor.stack.map((element) => element.tag).lastIndexOf(tag);

  if (index !== -1) cursor.stack.length = index;
}

function skipPast(cursor: Cursor, marker: string, from: number): void {
  const end = cursor.source.indexOf(marker, from);
  cursor.at = end === -1 ? cursor.source.length : end + marker.length;
}

// One `<…>` construct at the cursor; false when the `<` starts no markup (it is then text).
function readMarkup(cursor: Cursor): boolean {
  const rest = cursor.source.slice(cursor.at, cursor.at + 256);

  if (rest.startsWith('<!--')) {
    skipPast(cursor, '-->', cursor.at + 4);

    return true;
  }

  if (rest.startsWith('<!') || rest.startsWith('<?')) {
    skipPast(cursor, '>', cursor.at);

    return true;
  }

  const close = TAG_CLOSE.exec(rest);

  if (close) {
    closeTag(cursor, close[1], close[0].length);

    return true;
  }

  const open = TAG_OPEN.exec(rest);

  if (!open) return false;

  openTag(cursor, open[1]);

  return true;
}

/** The nodes of an HTML fragment. Never throws: malformed markup degrades to text or is skipped. */
export function parseHtml(source: string): HtmlNode[] {
  const root: HtmlElementNode = { kind: 'element', tag: '#root', attrs: {}, children: [] };
  const cursor: Cursor = { source, at: 0, root, stack: [] };

  while (cursor.at < source.length) {
    const next = source.indexOf('<', cursor.at);

    if (next === -1) {
      appendText(cursor, source.slice(cursor.at));

      break;
    }

    appendText(cursor, source.slice(cursor.at, next));
    cursor.at = next;

    if (!readMarkup(cursor)) {
      appendText(cursor, '<');
      cursor.at += 1;
    }
  }

  return root.children;
}
