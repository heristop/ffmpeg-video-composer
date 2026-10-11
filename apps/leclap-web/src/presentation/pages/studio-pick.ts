import type { TemplateOrientation } from '@leclap/creative-kit';
import { sampleFormatFor } from '@/presentation/components/onboarding.logic';

interface Pickable {
  id: string;
  orientation: TemplateOrientation;
  formats?: readonly TemplateOrientation[];
}

/**
 * Where a gallery pick opens the editor. A template composed for several formats opens in the one the
 * device calls for, by the onboarding's rule (portrait on a phone held upright, landscape on a desktop);
 * any other opens as authored. `format` is set only when it differs from the template's own.
 */
export const studioPick = (
  template: Pickable,
  viewport: { width: number; height: number }
): { href: string; format?: TemplateOrientation } => {
  const href = `/studio/new?template=${encodeURIComponent(template.id)}`;
  const format = sampleFormatFor(viewport);

  if (format === template.orientation || !template.formats?.includes(format)) return { href };

  return { href: `${href}&format=${format}`, format };
};
