import { z } from 'zod';

// An FFmpeg expression the engine splices into a filtergraph itself (an overlay position, a scale, a crop
// rectangle, a layer box): numbers, identifiers (iw, ih, W, h, PI…), arithmetic and parentheses, with `:`
// only between the parts a field takes ("x:y", "w:h"). No `,` `;` `[` `]` `'` `\` `=` or whitespace, so a
// value cannot end its option or filter, chain another one or relabel a pad. The render applies the same
// grammar (core/arg-guard.ts assertSafeExpression), so a skipped validation cannot bypass it.
const TERM = String.raw`[A-Za-z0-9_.+\-*/%^()]+`;

/** The grammar of an expression made of `parts` `:`-separated terms. */
export function expressionPattern(parts: number): RegExp {
  return new RegExp(`^${TERM}(?::${TERM}){${parts - 1}}$`);
}

const ONE = expressionPattern(1);
const TWO = expressionPattern(2);

/** A number, or one expression term ("iw*0.5", "(iw-ow)/2"). */
export const FilterExpression = z.union([
  z.number(),
  z.string().regex(ONE, 'an FFmpeg expression: numbers, names such as iw or ih, + - * / % ^ and parentheses'),
]);

/** Two `:`-separated expression terms: an overlay position "x:y" or a scale "w:h". */
export const FilterExpressionPair = z
  .string()
  .regex(TWO, 'two FFmpeg expressions as "a:b": numbers, names such as W or iw, + - * / % ^ and parentheses');
