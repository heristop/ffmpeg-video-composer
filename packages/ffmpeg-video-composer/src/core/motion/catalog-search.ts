// Catalog search: rank motion catalog entries against a plain-language need ("punchy word on the beat",
// "calm instructions") instead of handing an agent the whole catalog. Scoring is token overlap over each
// entry's name, verb, useWhen and description — with avoidWhen counting against it — so the same query
// always returns the same ranking. Pure.

import { motionCatalog, type MotionCatalog } from './catalog';
import { EXTRA_CATALOG_KINDS, extraEntries, type SearchEntry } from './catalog-search-extras';

export const CATALOG_KINDS = [
  'kinetic',
  'camera',
  'graphic',
  'transition',
  'blueprint',
  'doctrine',
  'theme',
  'platform',
  'easing',
  ...EXTRA_CATALOG_KINDS,
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export interface CatalogMatch {
  kind: CatalogKind;
  name: string;
  score: number;
  /** Query words this entry matched. */
  matched: string[];
  /** The catalog entry itself, as `get_motion_catalog` returns it. */
  entry: unknown;
}

export interface CatalogSearch {
  query: string;
  kind?: CatalogKind;
  matches: CatalogMatch[];
}

type Indexed = SearchEntry<CatalogKind>;

const STOPWORDS = new Set(
  'a an and are as at be by for from i in into is it of on or so that the this to with want need some my me'.split(' ')
);
const NAME_WEIGHT = 3;
const EXACT_NAME_BONUS = 5;
const DEFAULT_LIMIT = 8;

function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);

  if (word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);

  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** Lower-cased, stemmed content words. */
export function searchTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 1 && !STOPWORDS.has(word))
        .map(stem)
    ),
  ];
}

type Guide = { verb?: string; useWhen?: string; avoidWhen?: string; description?: string; pairsWith?: string[] };

function guided(kind: CatalogKind, name: string, entry: Guide & object): Indexed {
  return {
    kind,
    name,
    fields: [
      [name, NAME_WEIGHT],
      [entry.verb ?? '', 2],
      [entry.useWhen ?? '', 2],
      [entry.description ?? '', 1.5],
      [(entry.pairsWith ?? []).join(' '), 0.5],
    ],
    against: entry.avoidWhen ?? '',
    entry,
  };
}

function plain(kind: CatalogKind, name: string, text: string, entry: unknown): Indexed {
  return {
    kind,
    name,
    fields: [
      [name, NAME_WEIGHT],
      [text, 1.5],
    ],
    against: '',
    entry,
  };
}

function motionEntries(catalog: MotionCatalog): Indexed[] {
  return [
    ...catalog.kinetic.presets.map((entry) => guided('kinetic', entry.preset, entry)),
    ...catalog.camera.presets.map((entry) => guided('camera', entry.preset, entry)),
    ...Object.entries(catalog.graphics).map(([name, entry]) => guided('graphic', name, entry)),
    ...Object.entries(catalog.transitions).map(([name, entry]) => guided('transition', name, entry)),
    ...catalog.blueprints.map((entry) =>
      guided('blueprint', entry.name, { ...entry, description: `${entry.roles.join(' ')} ${entry.signatureMove}` })
    ),
    ...catalog.easing.named.map((name) => plain('easing', name, 'easing curve', name)),
  ];
}

function styleEntries(catalog: MotionCatalog): Indexed[] {
  return [
    ...Object.entries(catalog.doctrine).map(([name, entry]) => ({
      ...plain('doctrine', name, `${entry.summary} ${entry.do.join(' ')}`, entry),
      against: entry.avoid.join(' '),
    })),
    ...catalog.themes.themes.map((entry) => plain('theme', entry.name, entry.description, entry)),
    ...catalog.platforms.map((entry) =>
      plain('platform', entry.id, `${entry.title} ${entry.aliases.join(' ')} ${entry.orientation}`, entry)
    ),
  ];
}

function overlap(query: readonly string[], text: string): string[] {
  const words = new Set(searchTokens(text));

  return query.filter((word) => words.has(word));
}

function score(entry: Indexed, query: readonly string[], raw: string): CatalogMatch | null {
  const matched = new Set<string>();
  let total = entry.name.toLowerCase() === raw ? EXACT_NAME_BONUS : 0;

  for (const [text, weight] of entry.fields) {
    const hits = overlap(query, text);

    total += hits.length * weight;

    for (const hit of hits) matched.add(hit);
  }

  total -= overlap(query, entry.against).length;

  if (matched.size === 0 || total <= 0) return null;

  return {
    kind: entry.kind,
    name: entry.name,
    score: Number(total.toFixed(2)),
    matched: [...matched],
    entry: entry.entry,
  };
}

/**
 * The catalog entries that best answer `query`, best first (ties: catalog order). `kind` limits the
 * search to one section of the catalog. An empty `matches` means the catalog has nothing for it.
 */
export function searchMotionCatalog(
  query: string,
  options: { kind?: CatalogKind; limit?: number } = {},
  catalog: MotionCatalog = motionCatalog()
): CatalogSearch {
  const tokens = searchTokens(query);
  const raw = query.trim().toLowerCase();
  const pool = [...motionEntries(catalog), ...styleEntries(catalog), ...extraEntries(catalog)].filter(
    (entry) => options.kind === undefined || entry.kind === options.kind
  );
  const matches = pool
    .map((entry) => score(entry, tokens, raw))
    .filter((match): match is CatalogMatch => match !== null)
    // Engine primitives first: a library sample (a demo asset) only ranks after every engine match.
    .sort((a, b) => Number(a.kind === 'sample') - Number(b.kind === 'sample') || b.score - a.score)
    .slice(0, options.limit ?? DEFAULT_LIMIT);

  return { query, ...(options.kind && { kind: options.kind }), matches };
}
