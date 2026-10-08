// HTML character references: the named ones an author is likely to type, plus every numeric form. An
// unknown name is left as written, as a browser does.

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  deg: '°',
  middot: '·',
  bull: '•',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  times: '×',
  sup2: '²',
  sup3: '³',
};

const REFERENCE = /&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,15}));?/g;

function fromCodePoint(code: number, match: string): string {
  const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);

  return valid ? String.fromCodePoint(code) : match;
}

/** Text with its character references decoded. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;

  return text.replace(REFERENCE, (match, decimal?: string, hex?: string, name?: string) => {
    if (decimal !== undefined) return fromCodePoint(Number.parseInt(decimal, 10), match);

    if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16), match);

    return name !== undefined && Object.hasOwn(NAMED, name) ? NAMED[name] : match;
  });
}

/** The first capture group from `from` on that matched (alternatives each capture into their own group). */
export function firstGroup(match: RegExpMatchArray, from: number): string {
  for (let index = from; index < match.length; index++) {
    const group = match[index] as string | undefined;

    if (group !== undefined) return group;
  }

  return '';
}

/** Text safe to place in HTML content or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
