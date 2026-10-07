// Pure "did you mean" helpers shared by the schema findings and the descriptor rules. No zod, no
// node imports: the validator ships in the browser and React Native bundles too.

// Optimal string alignment distance (Levenshtein plus adjacent transpositions), so "rize" → "rise"
// and "fdae" → "fade" both cost what a human would expect.
export function editDistance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);

  for (let j = 1; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = cellCost(rows, a, b, i, j);
    }
  }

  return rows[a.length][b.length];
}

function cellCost(rows: number[][], a: string, b: string, i: number, j: number): number {
  const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
  const best = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + substitution);
  const transposed = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];

  return transposed ? Math.min(best, rows[i - 2][j - 2] + 1) : best;
}

// Case, hyphens, underscores and spaces never carry meaning in a key or token: "font-size",
// "font_size" and "FontSize" all name "fontsize".
export function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[-_\s]/g, '');
}

// How far a typo may drift: a short token tolerates one edit (else "in" would match "up"), longer
// ones two, or a third of their length for long names.
function maxDistance(length: number): number {
  return length <= 3 ? 1 : Math.max(2, Math.floor(length / 3));
}

// The closest candidate to `input`, or undefined when nothing is close enough to be a typo. A
// candidate equal once normalized always wins; ties keep the candidate order.
export function nearest(input: string, candidates: readonly string[]): string | undefined {
  const normalized = normalizeToken(input);
  const exact = candidates.find((candidate) => normalizeToken(candidate) === normalized);

  if (exact !== undefined) return exact;

  let best: string | undefined;
  let bestDistance = maxDistance(normalized.length) + 1;

  for (const candidate of candidates) {
    const distance = editDistance(normalized, normalizeToken(candidate));

    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

const MAX_LISTED_OPTIONS = 12;

// `"a", "b", … (+N more)` — long enums (58 xfade names) stay readable in one hint line.
export function formatOptions(values: readonly unknown[]): string {
  const shown = values.slice(0, MAX_LISTED_OPTIONS).map((value) => JSON.stringify(value));
  const rest = values.length - shown.length;

  return rest > 0 ? `${shown.join(', ')}, … (+${rest} more)` : shown.join(', ');
}
