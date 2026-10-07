// Declared `global.fields` that no form section asks for still need a value (a required one fails the render
// without it). The builder gathers them into one synthetic form scene, "Template inputs", so they can be
// filled and so progress and the next cue account for them. A form field of the same name binds a
// declared field and keeps it out of this scene.
import { declaredFields } from '@/core/fields';
import type { TemplateDescriptor } from 'ffmpeg-video-composer/src/core/types.d.ts';

/** The synthetic scene's name: a section name no template uses (it is not a valid identifier). */
export const TEMPLATE_INPUTS_SECTION = '#template-inputs';

export const TEMPLATE_INPUTS_TITLE: Record<string, string> = {
  en: 'Template inputs',
  fr: 'Champs du modèle',
  de: 'Vorlagenfelder',
  es: 'Campos de la plantilla',
  it: 'Campi del modello',
};

export interface TemplateInputField {
  name: string;
  label: Record<string, string>;
  maxLength?: number;
}

function formFieldNames(descriptor: TemplateDescriptor): Set<string> {
  return new Set(
    (descriptor.sections ?? []).flatMap((section) =>
      section.type === 'form' ? (section.options?.fields ?? []).map((field) => field.name) : []
    )
  );
}

/** The declared fields of an (expanded) descriptor that no form section asks for, in declaration order. */
export function templateInputFields(descriptor: TemplateDescriptor): TemplateInputField[] {
  const asked = formFieldNames(descriptor);

  return declaredFields(descriptor.global)
    .filter((field) => !asked.has(field.name))
    .map((field) => ({
      name: field.name,
      label: field.label ?? { en: field.name },
      ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }),
    }));
}
