// What a section actually draws on screen, in draw order — obtained by running the renderer's own
// lowerings (the overlay SUGAR_COMPILERS, the global overlay lowering) rather than re-deriving their layout here.
// A hand-kept mirror of each preset drifted every time a preset changed, and never covered the
// presets nobody mirrored (titleCard, the lowerThird badge, global overlays); reading the emitted
// drawtext/drawbox filters makes the renderer the single source of where text lands.
import type { Filter, Section } from '@/core/types';
import { OVERLAY_SUGAR_COMPILERS } from '../../editor/presets/overlay-sugars';
import type { SugarContext } from '../../editor/presets/sugar-context';
import { globalTextOverlayToFilters } from '../../editor/presets/text-blocks';

export interface DrawLayer {
  kind: 'text' | 'panel';
  values: Record<string, unknown>;
  // Where the author edits the thing that produced this filter.
  path: string;
  label: string;
  // Whether this layer's position is the author's to change. A preset pins it otherwise (a lowerThird
  // band, a title-card line), and a finding whose only remedy is "move it" is noise — see rules.ts.
  authoredPosition: boolean;
}

// The text fields each overlay sugar lowers to one drawtext line apiece, and how a finding names them.
const SUGAR_TEXT_FIELDS: Record<string, { label: string; fields: string[] }> = {
  caption: { label: 'caption', fields: ['text'] },
  titleCard: { label: 'title card', fields: ['kicker', 'headline', 'subtitle'] },
  lowerThird: { label: 'lower third', fields: ['title', 'subtitle', 'badge'] },
};

const OVERLAY_COMPILERS = [...OVERLAY_SUGAR_COMPILERS].sort((a, b) => a.order - b.order);

function isDrawFilter(filter: Filter | null | undefined): filter is Filter & { values: Record<string, unknown> } {
  return (filter?.type === 'drawtext' || filter?.type === 'drawbox') && filter.values !== undefined;
}

function kindOf(filter: Filter): DrawLayer['kind'] {
  return filter.type === 'drawtext' ? 'text' : 'panel';
}

// The drawtext line's source field, found by the text it carries: every lowering copies the
// Translation onto `values.text` unchanged (`{ ...spec.text }`).
function sourceField(sugar: Record<string, unknown>, fields: string[], text: unknown): string | null {
  const wanted = JSON.stringify(text);

  return fields.find((field) => JSON.stringify(sugar[field]) === wanted) ?? null;
}

interface Owner {
  path: string;
  label: string;
}

function sugarLayers(section: Section, ctx: SugarContext, owner: Owner): DrawLayer[] {
  const layers: DrawLayer[] = [];

  for (const compiler of OVERLAY_COMPILERS) {
    const spec = SUGAR_TEXT_FIELDS[compiler.key] as { label: string; fields: string[] } | undefined;
    const sugar = (section as unknown as Record<string, Record<string, unknown> | undefined>)[compiler.key];

    for (const filter of compiler.compile(section, ctx).filter(isDrawFilter)) {
      const field =
        spec && sugar && compiler.key !== 'caption' ? sourceField(sugar, spec.fields, filter.values.text) : null;
      const kind = kindOf(filter);

      layers.push({
        kind,
        values: filter.values,
        path: `${owner.path}.${compiler.key}${field ? `.${field}` : ''}`,
        label: `${owner.label} ${spec?.label ?? compiler.key}${field ? ` ${field}` : ''}`,
        // Only a caption's position is a choice the author makes (`position`/`align`).
        authoredPosition: compiler.key === 'caption' && kind === 'text',
      });
    }
  }

  return layers;
}

// Authored drawtext/drawbox filters run first — SegmentBuilder puts the overlay sugar on top of them.
function authoredLayers(section: Section, owner: Owner): DrawLayer[] {
  const filters: (Filter | null | undefined)[] = Array.isArray(section.filters) ? section.filters : [];
  const layers: DrawLayer[] = [];

  for (const [index, filter] of filters.entries()) {
    if (isDrawFilter(filter)) {
      layers.push({
        kind: kindOf(filter),
        values: filter.values,
        path: `${owner.path}.filters[${index}]`,
        label: `${owner.label} ${filter.type} filter ${index}`,
        authoredPosition: true,
      });
    }
  }

  return layers;
}

interface OverlayLike {
  sections?: string[];
}

// compileGlobalDecorations' fan-out, per overlay so each finding can name the overlay it came from.
function globalLayers(section: Section, overlays: unknown, ctx: SugarContext): DrawLayer[] {
  const list: (OverlayLike | null | undefined)[] = Array.isArray(overlays) ? overlays : [];
  const layers: DrawLayer[] = [];

  for (const [index, overlay] of list.entries()) {
    if (!overlay || (overlay.sections !== undefined && !overlay.sections.includes(section.name))) {
      continue;
    }

    const filters = globalTextOverlayToFilters(overlay as Parameters<typeof globalTextOverlayToFilters>[0], ctx);

    for (const filter of filters.filter(isDrawFilter)) {
      layers.push({
        kind: kindOf(filter),
        values: filter.values,
        path: `global.overlays[${index}]`,
        label: `Global overlay ${index}`,
        authoredPosition: false,
      });
    }
  }

  return layers;
}

export function sectionDrawLayers(
  section: Section,
  global: { overlays?: unknown } | undefined,
  ctx: SugarContext,
  owner: Owner
): DrawLayer[] {
  return [
    ...authoredLayers(section, owner),
    ...sugarLayers(section, ctx, owner),
    ...globalLayers(section, global?.overlays, ctx),
  ];
}
