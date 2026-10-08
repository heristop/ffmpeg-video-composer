// Styled HTML → the element tree Satori lays out. Satori is a flexbox engine without inline formatting, so
// the browser's block and inline flow are rebuilt on flexbox here:
//   - an element holding only text keeps it as one string (Satori wraps it itself);
//   - a container of elements without an authored `display` stacks them as a flex column (a row for an
//     inline tag), as block flow would;
//   - text mixed with inline elements (`Hello <strong>big</strong> world`) flows word by word in a
//     wrapping flex row, each word carrying its inline styles; a styled inline element (a badge with a
//     background or padding) stays whole, and `<br>` breaks the line.
// An authored `display` is kept as written, its children becoming flex items.

import type { LayerStyle } from './css-properties';
import type { StyledElement, StyledNode } from './html-styles';

export interface LayerElement {
  type: string;
  props: {
    style: LayerStyle;
    children?: LayerChild[];
    src?: string;
    width?: number;
    height?: number;
  };
}

export type LayerChild = LayerElement | string;

/** A style's own value for `key` (styles are plain records, so a missing key reads as undefined). */
export function styleValue(style: LayerStyle, key: string): string | undefined {
  return Object.hasOwn(style, key) ? style[key] : undefined;
}

export interface LayerBox {
  width: number;
  height: number;
  /** The family text falls back to (the theme's body font). */
  fontFamily: string;
}

const INLINE_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'u', 's', 'mark', 'small', 'sup', 'sub', 'br', 'img']);

// What a browser's user-agent sheet gives these tags, applied to every word they hold.
const INLINE_PRESETS: Readonly<Record<string, LayerStyle>> = {
  strong: { fontWeight: '700' },
  b: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  i: { fontStyle: 'italic' },
  u: { textDecoration: 'underline' },
  s: { textDecoration: 'line-through' },
  small: { fontSize: '0.8em' },
  sup: { fontSize: '0.7em' },
  sub: { fontSize: '0.7em' },
  mark: { backgroundColor: '#fff685', color: '#141416' },
};

// An inline element styled as a box is laid out whole rather than split into words.
const BOX_STYLE =
  /^(?:background|padding|border|margin|boxShadow|width|height|minWidth|maxWidth|display|position|transform|opacity|overflow)/;

const JUSTIFY: Readonly<Record<string, string>> = { center: 'center', right: 'flex-end', end: 'flex-end' };

function isElement(node: StyledNode): node is StyledElement {
  return typeof node !== 'string';
}

function isBlank(node: StyledNode): boolean {
  return typeof node === 'string' && node.trim() === '';
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function isAtomic(element: StyledElement): boolean {
  return element.tag === 'img' || Object.keys(element.style).some((key) => BOX_STYLE.test(key));
}

function pixels(value: string | undefined): number | undefined {
  const parsed = Number.parseFloat(value ?? '');

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function buildImage(element: StyledElement): LayerElement {
  const width = pixels(element.attrs.width);
  const height = pixels(element.attrs.height);

  return {
    type: 'img',
    props: {
      style: element.style,
      src: element.attrs.src ?? '',
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
    },
  };
}

// List items take their marker as leading text: "• " in a <ul>, "1. " in an <ol>.
function withListMarkers(element: StyledElement): StyledNode[] {
  if (element.tag !== 'ul' && element.tag !== 'ol') return element.children;

  let count = 0;

  return element.children.map((child) => {
    if (!isElement(child) || child.tag !== 'li') return child;

    count++;
    const marker = element.tag === 'ul' ? '• ' : `${count}. `;

    return { ...child, children: [marker, ...child.children] };
  });
}

interface FlowItem {
  style: LayerStyle;
  text: string;
}

type FlowEntry = FlowItem | LayerElement;

function isFlowItem(entry: FlowEntry | undefined): entry is FlowItem {
  return entry !== undefined && 'text' in entry;
}

function pushText(text: string, style: LayerStyle, items: FlowEntry[]): void {
  for (const part of collapse(text).split(/( )/)) {
    if (part === '') continue;

    const last = items.at(-1);

    if (part !== ' ') {
      items.push({ style, text: part });

      continue;
    }

    pushSpace(last, style, items);
  }
}

// A space joins the word before it; after a whole element it is an item of its own; at the start of the
// flow it is dropped, as a browser drops leading whitespace.
function pushSpace(last: FlowEntry | undefined, style: LayerStyle, items: FlowEntry[]): void {
  if (last === undefined) return;

  if (!isFlowItem(last)) {
    items.push({ style, text: ' ' });

    return;
  }

  if (!last.text.endsWith(' ')) last.text += ' ';
}

function flow(nodes: StyledNode[], inherited: LayerStyle, items: FlowEntry[]): void {
  for (const node of nodes) {
    if (!isElement(node)) {
      pushText(node, inherited, items);

      continue;
    }

    if (node.tag === 'br') {
      items.push({ type: 'div', props: { style: { flexBasis: '100%', height: '0px' } } });

      continue;
    }

    if (isAtomic(node)) {
      items.push(buildElement(node));

      continue;
    }

    flow(node.children, { ...inherited, ...INLINE_PRESETS[node.tag], ...node.style }, items);
  }
}

function flowElement(element: StyledElement, children: StyledNode[]): LayerElement {
  const items: FlowEntry[] = [];
  flow(children, {}, items);

  const align = styleValue(element.style, 'textAlign') ?? '';
  const justify = Object.hasOwn(JUSTIFY, align) ? JUSTIFY[align] : undefined;
  const style: LayerStyle = {
    ...element.style,
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    ...(justify && { justifyContent: justify }),
  };
  const built = items.map((entry): LayerElement => {
    if (!isFlowItem(entry)) return entry;

    return { type: 'span', props: { style: { ...entry.style, whiteSpace: 'pre' }, children: [entry.text] } };
  });

  return { type: element.tag, props: { style, children: built } };
}

function buildChildren(children: StyledNode[]): LayerChild[] {
  return children.flatMap((child): LayerChild[] => {
    if (isElement(child)) return [buildElement(child)];

    const text = collapse(child).trim();

    return text === '' ? [] : [text];
  });
}

/** One styled element as a Satori element (see the layout rules at the top of this file). */
export function buildElement(element: StyledElement): LayerElement {
  if (element.tag === 'img') return buildImage(element);

  const children = withListMarkers(element);

  if (children.every((child) => !isElement(child))) {
    const text = collapse(children.filter((child) => typeof child === 'string').join('')).trim();
    // Satori splits a div's text into words and then wants the div to be a flex box.
    const flexDiv = element.tag === 'div' && styleValue(element.style, 'display') === undefined;
    const style = flexDiv ? { display: 'flex', ...element.style } : element.style;

    return { type: element.tag, props: { style, children: text === '' ? [] : [text] } };
  }

  if (styleValue(element.style, 'display') !== undefined) {
    return { type: element.tag, props: { style: element.style, children: buildChildren(children) } };
  }

  const inline = children.every((child) => !isElement(child) || INLINE_TAGS.has(child.tag));
  const hasText = children.some((child) => !isElement(child) && !isBlank(child));

  if (inline && hasText) return flowElement(element, children);

  const style: LayerStyle = INLINE_TAGS.has(element.tag)
    ? { display: 'flex', ...element.style }
    : { display: 'flex', flexDirection: 'column', ...element.style };

  return { type: element.tag, props: { style, children: buildChildren(children) } };
}

/** The layer's root: a flex column the size of the box, in the default font, holding the content. */
export function buildLayerElement(nodes: StyledNode[], box: LayerBox): LayerElement {
  const built = buildElement({ tag: 'div', attrs: {}, style: {}, children: nodes });
  const style: LayerStyle = {
    display: 'flex',
    flexDirection: 'column',
    ...built.props.style,
    width: `${box.width}px`,
    height: `${box.height}px`,
    fontFamily: box.fontFamily,
  };

  return { type: 'div', props: { ...built.props, style } };
}
