// HTML layers in the builder model: a section's `type: "html"` inputs as editable layers and back. The
// name is kept (maps reference the layer as `@name`); the show window is start/end in the editor and
// start/duration on the input, as for still images.
import type { Section } from 'ffmpeg-video-composer/src/core/types.d.ts';
import { makeTemplateId, type Reveal } from './model';

// An HTML layer (descriptor `inputs[]` of type "html"): HTML + CSS the engine lays out and draws once to a
// transparent still, then composites like an image. `name` is the input name maps reference (`@name`);
// `width`/`height` are its box in output pixels. Placement, show window and motion follow ImageOverlay.
export interface HtmlLayer {
  // Editor-only stable key for list rendering/reorder; never written to the descriptor.
  id: string;
  name?: string;
  html: string;
  css?: string;
  width: number;
  height: number;
  position?: string;
  scale?: string;
  opacity?: number;
  rotation?: number;
  start?: number;
  end?: number;
  motion?: Reveal;
}

type StoredInput = NonNullable<Section['inputs']>[number];

// Trim float noise off a seconds result (0.3 - 0.1 → 0.2, not 0.19999999999999998).
function seconds(value: number): number {
  return Number(value.toFixed(4));
}

/** A fresh layer: a small card the preview shows at once, filled from a field the author renames. */
export function newHtmlLayer(): HtmlLayer {
  return {
    id: makeTemplateId(),
    html: '<div class="card"><span class="tag">New</span><p>{{ title }}</p></div>',
    css:
      '.card { display: flex; flex-direction: column; gap: 8px; padding: 24px 28px; border-radius: 20px; ' +
      'background: rgba(20, 20, 26, 0.85) } .tag { color: #FF8AAE; font: 600 22px Rubik; text-transform: uppercase } ' +
      'p { margin: 0; color: #FFFFFF; font: 700 44px Rubik }',
    width: 560,
    height: 180,
    position: '64:64',
  };
}

function windowFrom(options: NonNullable<StoredInput['options']>): Pick<HtmlLayer, 'start' | 'end'> {
  const start = options.start ?? 0;

  return {
    ...(start ? { start } : {}),
    ...(options.duration === undefined ? {} : { end: seconds(start + options.duration) }),
  };
}

function layerFrom(input: StoredInput): HtmlLayer {
  const options = input.options ?? {};

  return {
    id: input.name,
    name: input.name,
    html: input.html ?? '',
    ...(input.css === undefined ? {} : { css: input.css }),
    width: input.width ?? 0,
    height: input.height ?? 0,
    ...(options.position ? { position: options.position } : {}),
    ...(options.scale ? { scale: options.scale } : {}),
    ...(options.opacity !== undefined && options.opacity < 1 ? { opacity: options.opacity } : {}),
    ...(options.rotation ? { rotation: options.rotation } : {}),
    ...windowFrom(options),
    ...(options.motion ? { motion: options.motion } : {}),
  };
}

/** The section's HTML layers, in their stored order. */
export function htmlLayersFrom(section: Section): HtmlLayer[] {
  return (section.inputs ?? []).filter((input) => input.type === 'html').map(layerFrom);
}

function optionsOf(layer: HtmlLayer): NonNullable<StoredInput['options']> {
  const start = layer.start ?? 0;

  return {
    ...(layer.position ? { position: layer.position } : {}),
    ...(layer.scale ? { scale: layer.scale } : {}),
    ...(layer.opacity !== undefined && layer.opacity < 1 ? { opacity: layer.opacity } : {}),
    ...(layer.rotation ? { rotation: layer.rotation } : {}),
    ...(start > 0 ? { start } : {}),
    ...(layer.end !== undefined && layer.end > start ? { duration: seconds(layer.end - start) } : {}),
    ...(layer.motion ? { motion: layer.motion } : {}),
  };
}

/** The layers as `type: "html"` inputs, named `html_<i>` when the author gave no name. */
export function htmlInputsFrom(layers: HtmlLayer[] | undefined): NonNullable<Section['inputs']> {
  return (layers ?? []).map((layer, index) => {
    const options = optionsOf(layer);

    return {
      name: layer.name?.trim() ? layer.name.trim() : `html_${index}`,
      type: 'html',
      html: layer.html,
      ...(layer.css ? { css: layer.css } : {}),
      width: layer.width,
      height: layer.height,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
  });
}
