import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => {
          if (a === b) return 0;

          return a < b ? -1 : 1;
        })
        .map(([key, item]) => [key, canonical(item)])
    );
  }

  return value;
}

/** Stable identity for a JSON document; object key ordering does not affect a revision. */
export function templateRevision(template: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(template)))
    .digest('hex');
}
