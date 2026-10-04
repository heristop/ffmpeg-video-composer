import { fontRefSlug, isFontRef } from '../src/core/fonts';
import { captionToFilters } from '../src/editor/presets/captions';
import { globalTextOverlayToFilters, lowerThirdToFilters, titleCardToFilters } from '../src/editor/presets/text-blocks';
import type { Filter } from '../src/core/types';
import type { TemplateDescriptor } from '../src/schemas/template.schemas';
import type { SampleAsset } from '../src/samples/types';

function fontAssets(filters: Filter[], path: string): SampleAsset[] {
  return filters.flatMap((filter, index) => {
    const font = filter.values?.fontfile;

    if (filter.type !== 'drawtext' || (typeof font !== 'string' && !isFontRef(font))) return [];

    return [
      {
        kind: 'font',
        reference: typeof font === 'string' ? font : fontRefSlug(font),
        path: `${path}.filters[${index}].values.fontfile`,
        source: 'preset',
        ...(isFontRef(font) ? { font: { ...font } } : {}),
      },
    ];
  });
}

/** Resolve only pure text presets at generation time; leave descriptor tokens and assets untouched. */
export function sampleFontAssets(template: TemplateDescriptor): SampleAsset[] {
  const scale = { portrait: '720:1280', square: '1080:1080', landscape: '1280:720' }[
    template.global?.orientation ?? 'landscape'
  ];
  const result = (template.sections ?? []).flatMap((section, index) => {
    if (section.type === 'form' || section.type === 'music' || section.type === 'partial') return [];
    const path = `sections[${index}]`;

    return [
      ...fontAssets(captionToFilters(section.caption), `${path}.caption`),
      ...fontAssets(lowerThirdToFilters(section.lowerThird, { scale }), `${path}.lowerThird`),
      ...(section.type === 'color_background'
        ? fontAssets(titleCardToFilters(section.titleCard, { scale }), `${path}.titleCard`)
        : []),
    ];
  });
  const overlays = (template.global?.overlays ?? []).flatMap((overlay, index) =>
    fontAssets(globalTextOverlayToFilters(overlay, { scale }), `global.overlays[${index}]`)
  );

  return [...result, ...overlays];
}
