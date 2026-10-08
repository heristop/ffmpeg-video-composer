// The HTML allowlist of an HTML layer. Layout and text tags pass with `class` and `style` (and `src`/`alt`
// on images); anything that could run code, fetch, submit or embed is dropped with its content; any other
// tag is unwrapped (its content kept). Every removal is reported, so nothing disappears silently.

import type { HtmlElementNode, HtmlNode } from './html-parse';

export type HtmlFindingCode = 'html_unsupported_markup' | 'html_unsupported_css';

/** Where the dropped thing was written: the markup (tags, attributes, style attributes) or the stylesheet. */
export type HtmlFindingSource = 'html' | 'css';

export interface HtmlFinding {
  code: HtmlFindingCode;
  message: string;
  source: HtmlFindingSource;
}

export interface SanitisedHtml {
  nodes: HtmlNode[];
  findings: HtmlFinding[];
}

export const HTML_ALLOWED_TAGS: readonly string[] = [
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'mark',
  'small',
  'sup',
  'sub',
  'br',
  'img',
  'ul',
  'ol',
  'li',
  'section',
  'header',
  'footer',
  'article',
  'blockquote',
  'figure',
  'figcaption',
];

const ALLOWED = new Set(HTML_ALLOWED_TAGS);

// Dropped with everything inside them: they run code, load or embed resources, or take input.
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'textarea',
  'svg',
  'math',
  'template',
  'link',
  'meta',
  'base',
  'noscript',
  'video',
  'audio',
  'source',
  'track',
  'canvas',
  'title',
  'head',
  'portal',
]);

const GLOBAL_ATTRIBUTES = new Set(['class', 'style']);
const IMAGE_ATTRIBUTES = new Set(['src', 'alt', 'width', 'height']);

const DATA_IMAGE = /^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Whether `ref` names an image the engine reads from the template's own assets: a path relative to the
 * assets directory, a web-rooted `/assets/…` path, or an inline PNG/JPEG `data:` URI. No scheme, no
 * absolute device path, no `..`.
 */
export function isSafeAssetRef(ref: string): boolean {
  const value = ref.trim();

  if (DATA_IMAGE.test(value)) return true;

  if (value === '' || SCHEME.test(value) || value.startsWith('//') || value.includes('\\')) return false;

  if (value.split('/').includes('..')) return false;

  return !value.startsWith('/') || value.startsWith('/assets/');
}

interface Pass {
  findings: HtmlFinding[];
  seen: Set<string>;
}

function report(pass: Pass, message: string): void {
  if (pass.seen.has(message)) return;

  pass.seen.add(message);
  pass.findings.push({ code: 'html_unsupported_markup', message, source: 'html' });
}

function attributeMessage(tag: string, name: string): string {
  if (name.startsWith('on')) return `<${tag} ${name}>: event handler removed (HTML layers run no script)`;

  if (name === 'href') return `<${tag} href>: links removed (an HTML layer is a still image)`;

  return `<${tag} ${name}>: attribute removed (allowed: class, style; src, alt, width, height on img)`;
}

function allowedAttribute(tag: string, name: string): boolean {
  return GLOBAL_ATTRIBUTES.has(name) || (tag === 'img' && IMAGE_ATTRIBUTES.has(name));
}

function keptAttributes(element: HtmlElementNode, pass: Pass): Partial<Record<string, string>> {
  const attrs: Partial<Record<string, string>> = {};

  for (const [name, value] of Object.entries(element.attrs)) {
    if (allowedAttribute(element.tag, name)) {
      attrs[name] = value;

      continue;
    }

    report(pass, attributeMessage(element.tag, name));
  }

  return attrs;
}

function sanitiseImage(element: HtmlElementNode, pass: Pass): HtmlNode[] {
  const src = element.attrs.src ?? '';

  if (!isSafeAssetRef(src)) {
    report(
      pass,
      `<img src="${src}">: refused, an image must be one of the template's assets (a relative or /assets/ path)`
    );

    return [];
  }

  return [{ kind: 'element', tag: 'img', attrs: keptAttributes(element, pass), children: [] }];
}

function sanitiseElement(element: HtmlElementNode, pass: Pass): HtmlNode[] {
  if (DROPPED.has(element.tag)) {
    report(pass, `<${element.tag}>: removed with its content (not allowed in an HTML layer)`);

    return [];
  }

  if (element.tag === 'img') return sanitiseImage(element, pass);

  const children = sanitiseNodes(element.children, pass);

  if (!ALLOWED.has(element.tag)) {
    report(pass, `<${element.tag}>: unsupported tag, its content is kept without it`);

    return children;
  }

  return [{ kind: 'element', tag: element.tag, attrs: keptAttributes(element, pass), children }];
}

function sanitiseNodes(nodes: HtmlNode[], pass: Pass): HtmlNode[] {
  const out: HtmlNode[] = [];

  for (const node of nodes) {
    const kept = node.kind === 'text' ? [node] : sanitiseElement(node, pass);

    for (const child of kept) {
      const last = out.at(-1);

      if (child.kind === 'text' && last?.kind === 'text') {
        out[out.length - 1] = { kind: 'text', text: last.text + child.text };

        continue;
      }

      out.push(child);
    }
  }

  return out;
}

/** The allowlisted tree and a finding for every tag, attribute or image removed. */
export function sanitiseHtml(nodes: HtmlNode[]): SanitisedHtml {
  const pass: Pass = { findings: [], seen: new Set() };

  return { nodes: sanitiseNodes(nodes, pass), findings: pass.findings };
}
