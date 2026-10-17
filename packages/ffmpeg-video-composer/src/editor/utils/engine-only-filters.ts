// Filter options only the engine writes. A template never authors them, trusted (allowRawFilters) or not:
// checked at validation and by the render gate (filter-allow-list.ts) in every mode.

import type { ValidationError } from '../../services/validation/types';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * Engine-internal filter options a template never authors, trusted or not: `values.textExpr` is drawtext
 * text the lowering has already escaped (kinetic counters), so the formatter writes it as is.
 */
export function engineOnlyFilterIssues(descriptor: unknown): ValidationError[] {
  const issues: ValidationError[] = [];

  (function walk(node: unknown, path: string, key: string): void {
    if (Array.isArray(node)) {
      for (const [index, child] of node.entries()) {
        const at = `${path}[${index}]`;

        if (key === 'filters' && record(record(child)?.values)?.textExpr !== undefined) {
          issues.push({
            path: `${at}.values.textExpr`,
            message: 'values.textExpr is engine-internal.',
            code: 'filter_not_allowed',
            hint: 'Use values.text.',
          });
        }

        walk(child, at, '');
      }

      return;
    }

    for (const [childKey, child] of Object.entries(record(node) ?? {})) {
      walk(child, path ? `${path}.${childKey}` : childKey, childKey);
    }
  })(descriptor, '', '');

  return issues;
}
