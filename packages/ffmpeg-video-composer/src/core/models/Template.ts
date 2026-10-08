import { container, singleton } from 'tsyringe';
import type { TemplateAssets } from '../types';
import type { TemplateDescriptor } from '../../schemas/template.schemas';
import { BaseTemplateValidator, type ValidationResult } from '../../services/BaseTemplateValidator';
import { HTML_RASTERISER } from '../html/html-rasteriser';

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
  // Template is the browser / on-device validation path: those engines cannot analyze music nor transcribe
  // speech (both are pinned before compile). They draw HTML layers once the host registered a rasteriser
  // (the browser compile with its WebAssembly loader, the phone's WebView page), read at each validation.
  private get validator(): BaseTemplateValidator {
    return new BaseTemplateValidator({
      beatsAnalysis: false,
      transcription: false,
      htmlLayers: container.isRegistered(HTML_RASTERISER),
    });
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
