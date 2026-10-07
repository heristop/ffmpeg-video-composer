// `format`: a mechanical fix (a renamed key, a typo'd enum value) that is safe to apply without
// asking. `judgement`: the fix changes creative content (timing, a removed effect, a chosen value),
// so an agent should confirm with the author first.
export type ValidationFindingKind = 'format' | 'judgement';

export interface ValidationError {
  path: string;
  message: string;
  code: string;
  /** One actionable sentence saying how to fix the finding. */
  hint?: string;
  /** A concrete replacement value for the field at `path` (a key name for `unknown_key`). */
  suggestion?: unknown;
  /** Whether the suggested fix is safe to auto-apply (`format`) or needs the author (`judgement`). */
  kind?: ValidationFindingKind;
}
