// A counter that reads its number from the block's copy: `counter.to` omitted, `text` holding a value such
// as "{{ form_1_price }}". Form fields and variables only resolve at lowering time, so the number is parsed
// from the final copy there: the first number in it becomes `to`, the characters around it the prefix and
// suffix, and its own separators pick the decimals, the grouping and the locale, so the roll lands on the
// copy as typed ("EUR 24", "$1,299.00", "24,90 €"). Copy without a number is drawn as a plain fade.
// Pure: no engine imports.

import type { CounterSpec } from '../../schemas/text.schemas';

/** Roll length of a copy-driven counter without a block duration (its range is unknown until lowering). */
export const COPY_COUNTER_SECONDS = 0.9;

// A run of digits with separators between them (spaces, dots, commas, apostrophes), ending on a digit.
const NUMBER = /\d(?:[\d.,'’\u00A0\u202F ]*\d)?/;
const GROUP_ONLY = /^[\s'’\u00A0\u202F]$/;
const MAX_DECIMALS = 4;

interface ParsedNumber {
  value: number;
  decimals: number;
  /** Decimal mark used in the copy ('' when none). */
  mark: string;
  /** Group separator used in the copy ('' when none). */
  group: string;
}

// The separator that is the decimal mark, if any: the last of two kinds, or a lone '.'/',' not followed by
// exactly three digits ("1,500" groups, "24,90" and "9.5" are decimals).
function decimalMark(raw: string, separators: string[]): string {
  const last = separators.at(-1) ?? '';

  if (last === '' || GROUP_ONLY.test(last)) return '';

  if (new Set(separators).size > 1) return last;

  const tail = raw.length - raw.lastIndexOf(last) - 1;

  return separators.length === 1 && tail !== 3 && tail <= MAX_DECIMALS ? last : '';
}

function parseNumber(raw: string): ParsedNumber | null {
  const separators = [...raw.matchAll(/\D/g)].map((match) => match[0]);
  const mark = decimalMark(raw, separators);
  const group = separators.find((separator) => separator !== mark) ?? '';
  const markAt = mark ? raw.lastIndexOf(mark) : raw.length;
  const whole = raw.slice(0, markAt).replace(/\D/g, '');
  const fraction = mark ? raw.slice(markAt + 1).replace(/\D/g, '') : '';
  const value = Number(`${whole}.${fraction || '0'}`);

  if (!Number.isFinite(value) || value > 1e11) return null;

  return { value, decimals: fraction.length, mark, group: /^\s$/.test(group) ? ' ' : group };
}

// The counter locale whose separators reproduce the copy's (undefined: the template's own locale).
function localeOf(parsed: ParsedNumber): CounterSpec['locale'] {
  const { mark, group } = parsed;

  if (group === "'" || group === '’') return 'de-CH';

  if (mark === ',') return group === '.' ? 'de' : 'fr';

  if (mark === '.' || group === ',') return 'en';

  if (group === '.') return 'de';

  return group === ' ' ? 'fr' : undefined;
}

/**
 * The counter `copy` describes: its first number as `to`, the text around it as prefix and suffix, its
 * decimals, grouping and locale. Authored counter fields win. Null when the copy holds no number.
 */
export function counterFromCopy(counter: CounterSpec, copy: string): CounterSpec | null {
  const match = NUMBER.exec(copy);
  const parsed = match ? parseNumber(match[0]) : null;

  if (!match || !parsed) return null;

  const locale = counter.locale ?? localeOf(parsed);

  return {
    ...counter,
    to: parsed.value,
    decimals: counter.decimals ?? parsed.decimals,
    prefix: counter.prefix ?? copy.slice(0, match.index),
    suffix: counter.suffix ?? copy.slice(match.index + match[0].length),
    grouping: counter.grouping ?? parsed.group !== '',
    ...(locale && { locale }),
  };
}
