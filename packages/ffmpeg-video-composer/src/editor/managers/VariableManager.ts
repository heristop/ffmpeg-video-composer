import { inject, injectable } from 'tsyringe';
import type Template from '../../core/models/Template';
import type Project from '../../core/models/Project';
import type { Variables } from '@/core/types';

/** Escape a free-text value so it matches literally inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

@injectable()
class VariableManager {
  constructor(
    @inject('template') private readonly template: Template,
    @inject('project') private readonly project: Project
  ) {}

  mapVariables = (value: string): string => {
    const variables = this.template.descriptor.global?.variables;

    if (!variables) {
      return value;
    }

    return this.mapPlaceholders(value, variables);
  };

  private readonly mapPlaceholders = (value: string, placeholders: Variables): string => {
    const keys = Object.keys(placeholders);

    if (keys.length === 0) {
      return value;
    }

    // Resolve every placeholder in a single pass with one compiled regex instead of
    // recompiling a RegExp and re-scanning the whole string once per variable.
    const pattern = new RegExp(keys.map((key) => escapeRegExp(`{{ ${key} }}`)).join('|'), 'g');

    return value.replace(pattern, (match) => {
      // Recover the key from the matched "{{ key }}" placeholder.
      const placeholderValue = placeholders[match.slice(3, -3)];

      return Array.isArray(placeholderValue) ? placeholderValue.join(', ') : placeholderValue;
    });
  };

  /** The render-time value of a placeholder name: a global variable, else a form field (lists joined). */
  valueOf = (name: string): string | undefined => {
    const sources = [this.template.descriptor.global?.variables, this.project.config.fields];
    const source = sources.find((record) => record !== undefined && Object.hasOwn(record, name));
    const value = source?.[name];

    return Array.isArray(value) ? value.join(', ') : value;
  };

  /**
   * Replace fields
   */
  mapFields = (value: string): string => {
    const { fields } = this.project.config;

    if (!fields) {
      return value;
    }

    return this.mapPlaceholders(value, fields);
  };
}

export default VariableManager;
