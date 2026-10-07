// Plain-text renderings of validation findings for agents (MCP tools, the web builder's browser tools),
// so every surface words the same failure the same way. Pure and platform-neutral.
import type { ValidationError } from './validation/types';

/** `dotted.path: message → hint`, the hint only when the validator has an actionable fix. */
export function findingLine(error: ValidationError): string {
  const hint = error.hint ? ` → ${error.hint}` : '';

  return `${error.path || '(root)'}: ${error.message}${hint}`;
}

/** Every finding, one per line, so an agent can fix them all in one pass instead of one per call. */
export function invalidTemplateText(result: { message: string; errors?: ValidationError[] }): string {
  if (!result.errors || result.errors.length === 0) return result.message;

  return `Invalid template (${result.errors.length} finding(s)):\n- ${result.errors.map(findingLine).join('\n- ')}`;
}

/**
 * The first three findings as `dotted.path: message`, the rest capped with a `(+N more)` suffix, so the
 * full error tree (and any internal validator detail) never leaks into a one-line message.
 */
export function summarizeErrors(errors: ValidationError[]): string {
  const issues = errors.slice(0, 3).map(findingLine);
  const suffix = errors.length > 3 ? ` (+${errors.length - 3} more)` : '';

  return `Invalid template: ${issues.join('; ')}${suffix}`;
}
