import { singleton } from 'tsyringe';
import type { TemplateAssets } from '../types';
import type { TemplateDescriptor } from '../../schemas/template.schemas';
import { TemplateValidator, type ValidationResult } from '../../services/TemplateValidator';

function isTemplateDescriptor(data: unknown): data is TemplateDescriptor {
  return typeof data === 'object' && data !== null && !('name' in data && 'type' in data);
}

@singleton()
class Template {
  public descriptor: TemplateDescriptor = {};
  public assets: TemplateAssets = {
    fonts: {},
    musics: {},
    inputs: [],
  };
  private readonly validator: TemplateValidator;

  constructor() {
    this.validator = new TemplateValidator();
  }

  init = (): void => {
    this.assets = {
      fonts: {},
      musics: {},
      inputs: [],
    };
  };

  setDescriptor = (descriptor: unknown): ValidationResult => {
    const validation = this.validator.validateTemplate(descriptor);

    if (validation.success && validation.data && isTemplateDescriptor(validation.data)) {
      this.descriptor = validation.data;
    }

    return validation;
  };

  validateDescriptor = (): ValidationResult => {
    return this.validator.validateTemplate(this.descriptor);
  };

  loadFromJSON = (jsonString: string): ValidationResult => {
    const validation = this.validator.validateTemplateFromJSON(jsonString);

    if (validation.success && validation.data && isTemplateDescriptor(validation.data)) {
      this.descriptor = validation.data;
    }

    return validation;
  };

  clean = (): void => {
    this.init();
  };
}

export default Template;

export { assertEffectsResolved } from '../partials';
