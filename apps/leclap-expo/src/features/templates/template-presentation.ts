import type { Template } from '@/src/types';
import { buildDescriptionVars, resolveTranslation, resolveVariables } from '@/src/utils/i18nText';

export function templatePresentation(template: Template, locale: string) {
  const title =
    template.content.meta?.name ??
    template.name
      .replace(/\.json$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const vars = buildDescriptionVars(template.content.global?.variables, template.content.global?.colorsList);
  const raw = template.content.sections
    ?.map((section) => resolveTranslation(section.description, locale))
    .find(Boolean);

  return {
    title,
    description: raw ? resolveVariables(raw, vars) : template.content.meta?.description,
    orientation: template.content.global?.orientation ?? 'landscape',
  };
}

function normalized(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

export function filterTemplates(templates: Template[], query: string, locale: string): Template[] {
  const search = normalized(query);

  if (!search) return templates;

  return templates.filter((template) => {
    const display = templatePresentation(template, locale);
    const vars = buildDescriptionVars(template.content.global?.variables, template.content.global?.colorsList);
    const sectionCopy = (template.content.sections ?? []).flatMap((section) => [
      resolveTranslation(section.title, locale) ?? '',
      resolveVariables(resolveTranslation(section.description, locale) ?? '', vars),
    ]);

    return [template.name, display.title, display.description ?? '', ...sectionCopy].some((text) =>
      normalized(text).includes(search)
    );
  });
}

export function templateColumns(width: number, fontScale: number): number {
  if (fontScale >= 1.3 || width < 360) return 1;

  if (width >= 1000) return 4;
  if (width >= 700) return 3;

  return 2;
}
