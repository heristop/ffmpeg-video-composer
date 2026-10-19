// Descriptor rules for masks (`inputs[].options.mask`, video / project_video `options.mask`):
// - mask_layer_unknown: a track matte names no image, animation or html input of its section (nearest name hinted);
// - mask_layer_self / mask_layer_shared / mask_layer_chained: a layer that mattes itself, one matte read by two
//   masks, a matte that is itself masked;
// - mask_not_layer: a mask on plain media (only image, animation and html inputs are composited as layers);
// - mask_with_clip: options.clip and options.mask on one layer (a rect mask is the clip with radius and feather);
// - mask_with_composite: options.mask with a non-normal options.blend or an options.motionBlur on one layer (the
//   masked layer composites through its own maps, which neither the blend nor the motion blur graph reaches);
// - mask_path_invalid / mask_too_large: the shape cannot be filled (editor/presets/mask-shape.ts placeMask).

import type { MaskShape } from '../schemas/mask.schemas';
import { placeMask } from '../editor/presets/mask-shape';
import { nearest } from './validation/suggest';
import type { ValidationError } from './validation/types';

type Bag = Record<string, unknown>;

const LAYER_TYPES = new Set(['image', 'animation', 'html']);

export interface MaskSite {
  mask: Bag;
  /** `sections[i].options.mask` or `sections[i].inputs[j].options.mask`. */
  path: string;
  /** The masked input's name; null for a section mask. */
  owner: string | null;
  /** Every input of the section. */
  inputs: Bag[];
  clip: boolean;
  /** The masked layer's own blend / motionBlur fields that cannot combine with the mask. */
  composite: ('blend' | 'motionBlur')[];
  /** The masked element is a layer (or the section's clip). */
  layer: boolean;
}

function list(value: unknown): Bag[] {
  return Array.isArray(value) ? value.filter((item): item is Bag => item !== null && typeof item === 'object') : [];
}

function maskOf(options: unknown): Bag | null {
  const mask = (options as Bag | undefined)?.mask;

  return mask !== null && typeof mask === 'object' ? (mask as Bag) : null;
}

// A non-normal blend and any motionBlur: each composites through a graph a masked layer never reaches.
function compositeFields(options: Bag | undefined): ('blend' | 'motionBlur')[] {
  const blend = options?.blend !== undefined && options.blend !== 'normal' ? (['blend'] as const) : [];
  const blur = options?.motionBlur === undefined ? [] : (['motionBlur'] as const);

  return [...blend, ...blur];
}

function sectionSites(section: Bag, i: number): MaskSite[] {
  const inputs = list(section.inputs);
  const own = maskOf(section.options);
  const layers = inputs.flatMap((input, j) => {
    const mask = maskOf(input.options);
    const path = `sections[${i}].inputs[${j}].options.mask`;
    const options = input.options as Bag | undefined;
    const clip = options?.clip !== undefined;
    const composite = compositeFields(options);
    const layer = LAYER_TYPES.has(String(input.type));

    return mask ? [{ mask, path, owner: String(input.name), inputs, clip, composite, layer }] : [];
  });
  const sectionSite = own && {
    mask: own,
    path: `sections[${i}].options.mask`,
    owner: null,
    inputs,
    clip: false,
    composite: [],
    layer: true,
  };

  return sectionSite ? [sectionSite, ...layers] : layers;
}

/** Every mask of a (partial-expanded) descriptor, section masks first in each section. */
export function maskSites(template: unknown): MaskSite[] {
  return list((template as { sections?: unknown } | null)?.sections).flatMap(sectionSites);
}

function unknownLayer(site: MaskSite, name: string): ValidationError {
  const names = site.inputs.filter((input) => LAYER_TYPES.has(String(input.type))).map((input) => String(input.name));
  const suggestion = nearest(name, names);

  return {
    path: `${site.path}.layer`,
    code: 'mask_layer_unknown',
    message: `no image, animation or html input named "${name}" in this section`,
    hint: suggestion
      ? `Did you mean "${suggestion}"?`
      : "Add the matte layer to this section's inputs, or use a shape.",
    ...(suggestion ? { suggestion, kind: 'format' as const } : {}),
  };
}

function layerErrors(site: MaskSite): ValidationError[] {
  const name = site.mask.layer;

  if (typeof name !== 'string') return [];

  const path = `${site.path}.layer`;

  if (name === site.owner) {
    return [{ path, code: 'mask_layer_self', message: `layer "${name}" cannot be its own track matte` }];
  }

  const matte = site.inputs.find((input) => input.name === name);

  if (!matte || !LAYER_TYPES.has(String(matte.type))) return [unknownLayer(site, name)];

  if (!maskOf(matte.options)) return [];

  return [
    {
      path,
      code: 'mask_layer_chained',
      message: `track matte "${name}" has a mask of its own`,
      hint: "Remove the matte layer's mask: mattes do not chain.",
    },
  ];
}

function ownerErrors(site: MaskSite): ValidationError[] {
  if (!site.layer) {
    return [
      {
        path: site.path,
        code: 'mask_not_layer',
        message: 'a mask applies to image, animation and html inputs',
        hint: 'Give the input a type, or remove the mask.',
      },
    ];
  }

  if (!site.clip) return [];

  return [
    {
      path: site.path,
      code: 'mask_with_clip',
      message: 'options.clip and options.mask cut the same layer',
      hint: 'Keep one: a rect mask is a clip box with radius and feather.',
    },
  ];
}

function compositeErrors(site: MaskSite): ValidationError[] {
  const options = site.path.replace(/\.mask$/, '');

  return site.composite.map((field) => ({
    path: `${options}.${field}`,
    code: 'mask_with_composite',
    message: `options.mask cannot combine with ${field === 'blend' ? 'a non-normal blend' : 'motionBlur'} yet`,
    hint: `Keep one: drop options.${field}, or the mask.`,
  }));
}

function shapeErrors(site: MaskSite): ValidationError[] {
  if (!site.mask.shape) return [];

  const placed = placeMask(site.mask.shape as MaskShape, Number(site.mask.feather ?? 0));

  return placed.ok ? [] : [{ path: `${site.path}.shape`, code: placed.code, message: placed.message }];
}

// The second and later masks reading the same matte layer within one section.
function sharedErrors(sites: MaskSite[]): ValidationError[] {
  const seen = new Set<string>();

  return sites.flatMap((site) => {
    const name = site.mask.layer;

    if (typeof name !== 'string') return [];

    if (!seen.has(name)) {
      seen.add(name);

      return [];
    }

    return [
      {
        path: `${site.path}.layer`,
        code: 'mask_layer_shared',
        message: `track matte "${name}" is already read by another mask in this section`,
        hint: 'Duplicate the matte layer under a new name for the second mask.',
      },
    ];
  });
}

export function validateMasks(template: unknown): ValidationError[] {
  return list((template as { sections?: unknown } | null)?.sections).flatMap((section, i) => {
    const sites = sectionSites(section, i);

    return [
      ...sites.flatMap((site) => [
        ...ownerErrors(site),
        ...compositeErrors(site),
        ...layerErrors(site),
        ...shapeErrors(site),
      ]),
      ...sharedErrors(sites),
    ];
  });
}
