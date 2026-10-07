import { nearest } from './suggest';
import type { ValidationError } from './types';

type Reference = { name: string; known: string[]; fix: string };

export function knownNames(names: Set<string | undefined>): string[] {
  return [...names].filter((name): name is string => typeof name === 'string');
}

// A dangling reference: when a known name is a typo away, suggest it (safe to apply); otherwise the
// author has to decide what the reference should point at.
export function referenceFinding(path: string, message: string, code: string, ref: Reference): ValidationError {
  const suggestion = nearest(ref.name, ref.known);

  if (suggestion === undefined) {
    return { path, message, code, hint: `Rename the reference or ${ref.fix}.`, kind: 'judgement' };
  }

  return { path, message, code, hint: `Use "${suggestion}" instead of "${ref.name}".`, suggestion, kind: 'format' };
}
