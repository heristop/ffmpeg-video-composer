import { LOCALIZED_ROUTES } from '@/config/site';

// The 404's "did you mean": the page a mistyped, stale or truncated address was most likely after.

// The doc pages. config/doc-routes.ts carries their prerender copy and must stay out of the bundle, so only
// their paths are restated here; the drift test keeps the two lists in step.
const DOC_PATHS = [
  '/doc',
  '/doc/sections',
  '/doc/transitions',
  '/doc/looks',
  '/doc/grade',
  '/doc/motion',
  '/doc/audio',
  '/doc/captions',
  '/doc/animations',
  '/doc/filters',
  '/doc/examples',
  '/doc/schema',
  '/doc/cli',
  '/doc/mcp',
  '/doc/effects',
  '/doc/reference',
  '/doc/engine',
  '/doc/creative-direction',
  '/design',
];

// The app's own pages: unindexed, but real places to land.
const APP_PATHS = ['/studio/new', '/studio/builder', '/templates', '/templates/new', '/partials'];

/** Every page the router serves, less the redirects and home, which the 404 offers anyway. */
export const KNOWN_PATHS: readonly string[] = [
  ...LOCALIZED_ROUTES.map((route) => route.path).filter((path) => path !== '/'),
  ...DOC_PATHS,
  ...APP_PATHS,
];

/** Edits from one string to another, a swap of neighbours counting as one (optimal string alignment). */
const editDistance = (from: string, to: string): number => {
  const rows = Array.from({ length: from.length + 1 }, (_, i) =>
    Array.from({ length: to.length + 1 }, (_, j) => (i === 0 || j === 0 ? i + j : 0))
  );

  for (let i = 1; i <= from.length; i++) {
    for (let j = 1; j <= to.length; j++) {
      const substitution = rows[i - 1][j - 1] + (from[i - 1] === to[j - 1] ? 0 : 1);

      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, substitution);

      if (i > 1 && j > 1 && from[i - 1] === to[j - 2] && from[i - 2] === to[j - 1]) {
        rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
      }
    }
  }

  return rows[from.length][to.length];
};

/** How many slips an address of this length may carry and still read as a typo of a page. */
const slipBudget = (path: string): number => {
  if (path.length <= 6) return 1;

  if (path.length <= 12) return 2;

  return 3;
};

/** The page the address is a typo of, if any is close enough. */
const closest = (wanted: string): string | undefined => {
  let best: string | undefined;
  let bestDistance = slipBudget(wanted) + 1;

  for (const path of KNOWN_PATHS) {
    const distance = editDistance(wanted, path);

    if (distance < bestDistance) {
      best = path;
      bestDistance = distance;
    }
  }

  return best;
};

/** The longest page the address starts with: /doc/nothing → /doc, /docs → /doc, /about-us → /about. */
const longestPrefix = (wanted: string): string | undefined =>
  KNOWN_PATHS.filter((path) => wanted.startsWith(path)).toSorted((a, b) => b.length - a.length)[0];

/** The one page below an address that stops short: /compare → /compare/remotion. */
const onlyPageBelow = (wanted: string): string | undefined => {
  const below = KNOWN_PATHS.filter((path) => path.startsWith(`${wanted}/`));

  return below.length === 1 ? below[0] : undefined;
};

/**
 * The page a lost visitor most likely wanted, or null when no page is a fair guess — a wrong suggestion is
 * worse than none. Case and a trailing slash don't count.
 */
export const suggestPath = (pathname: string): string | null => {
  const wanted = pathname.toLowerCase().replace(/\/+$/, '');

  if (wanted === '') return null;

  return closest(wanted) ?? longestPrefix(wanted) ?? onlyPageBelow(wanted) ?? null;
};

export interface SentencePart {
  readonly text: string;
  /** Whether this part is the address, set in the page's monospaced chip. */
  readonly isPath: boolean;
}

// The copy marks where the address goes with <path/>, so each language puts it where its grammar wants it.
// The sentence is split into plain runs rather than parsed as markup (as lib/language-suggestion.ts does
// with its language names), so neither a translation nor a crafted address can inject HTML.
const PATH_SLOT = /(<path\/>)/;

/** A sentence with the address dropped into its <path/> slot, as runs of text; no empty runs at either end. */
export const withPath = (sentence: string, path: string): SentencePart[] =>
  sentence
    .split(PATH_SLOT)
    .filter((part) => part.length > 0)
    .map((part) => (part === '<path/>' ? { text: path, isPath: true } : { text: part, isPath: false }));
