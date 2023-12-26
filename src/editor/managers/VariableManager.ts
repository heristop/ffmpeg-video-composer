import { singleton } from 'tsyringe';
import Template from '../../core/models/Template';
import Project from '../../core/models/Project';
import { Variables } from '@/core/types';

@singleton()
class VariableManager {
  constructor(
    private readonly template: Template,
    private readonly project: Project
  ) {}

  mapVariables = (value: string): string => {
    const variables = this.template.descriptor.global?.variables;

    if (!variables) {
      return;
    }

    return this.mapPlaceholders(value, variables);
  };

  private mapPlaceholders = (value: string, placeholders: Variables): string => {
    if (placeholders && Object.keys(placeholders).length > 0) {
      Object.keys(placeholders).forEach((key) => {
        const placeholder = `{{ ${key} }}`;
        const placeholderValue = placeholders[key];

        const valueToReplace = Array.isArray(placeholderValue) ? placeholderValue.join(', ') : placeholderValue;

        value = value.replace(new RegExp(placeholder, 'g'), valueToReplace);
      });
    }

    return value;
  };

  /**
   * Replace fields
   */
  mapFields = (value: string): string => {
    const { fields } = this.project.config;

    return this.mapPlaceholders(value, fields);
  };
}

export default VariableManager;
