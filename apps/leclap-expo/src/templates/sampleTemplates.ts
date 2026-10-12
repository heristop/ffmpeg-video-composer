import type { TemplateDescriptor, Orientation } from '@/src/types';
import { APP_TEMPLATES, appTemplateInFormat, type AppTemplate } from '@leclap/creative-kit';

/** A template in the local catalog — a bundled @leclap/creative-kit sample, or a user-created one. */
export interface CatalogTemplate {
  id: string;
  name: string;
  description: string;
  orientation: Orientation;
  descriptor: TemplateDescriptor;
  source: 'sample' | 'user';
}

// The on-device catalog is authored once in @leclap/creative-kit — the single source of templates,
// shared with the web app. Every entry compiles on the phone as-is: the core remaps the GPL-only
// `eq` filter (used by the colour-grade looks) to an LGPL `lutyuv` LUT for the on-device engine, so
// no app-side descriptor rewriting is needed.
// A template composed for several formats opens in portrait on the phone, where the camera is held upright.
const onPhone = (t: AppTemplate): AppTemplate =>
  t.formats.includes('portrait') ? appTemplateInFormat(t, 'portrait') : t;

export const SAMPLE_TEMPLATES: CatalogTemplate[] = APP_TEMPLATES.map(onPhone).map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  orientation: t.orientation,
  source: 'sample',
  descriptor: t.descriptor as unknown as TemplateDescriptor,
}));
