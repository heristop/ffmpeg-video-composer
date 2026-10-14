// The validator `Template` checks descriptors with, registered by services/register-template-validator. The
// model reads it from here instead of importing it: the validator lowers every overlay sugar to find where text
// lands, so the browser entry exports `Template` without it and loads it on demand (loadTemplateValidation(),
// or the first compile). The Node and React Native entries load it with the model (core/models/Template).
import type { BaseTemplateValidator, ValidatorOptions } from '../../services/BaseTemplateValidator';

export type TemplateValidatorFactory = (options: ValidatorOptions) => BaseTemplateValidator;

let factory: TemplateValidatorFactory | null = null;

export function registerTemplateValidator(next: TemplateValidatorFactory): void {
  factory = next;
}

export function templateValidator(options: ValidatorOptions): BaseTemplateValidator {
  if (!factory) {
    throw new Error(
      'Template validation is not loaded: await loadTemplateValidation() from the browser entry (a compile loads it too) before validating a template.'
    );
  }

  return factory(options);
}
