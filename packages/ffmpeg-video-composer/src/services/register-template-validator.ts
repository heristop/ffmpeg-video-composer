// Loading this module makes `Template` validate: core/models/Template imports it for the Node and React Native
// entries, the browser entry imports it on demand (loadTemplateValidation(), resolveTemplateEffects(), compile).
import { registerTemplateValidator } from '../core/models/template-validation';
import { BaseTemplateValidator } from './BaseTemplateValidator';

registerTemplateValidator((options) => new BaseTemplateValidator(options));
