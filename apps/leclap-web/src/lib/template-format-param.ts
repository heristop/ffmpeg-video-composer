import type { TemplateOrientation } from '@leclap/creative-kit';

const FORMATS: readonly TemplateOrientation[] = ['landscape', 'portrait', 'square'];

/** The `?format=` of a studio link (`/studio/new?template=present-yourself&format=portrait`), if it names one. */
export const templateFormatParam = (value: string | null): TemplateOrientation | undefined =>
  FORMATS.find((format) => format === value);
