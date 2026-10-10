// Wires an HTML layer input into the asset stage (AssetManager.fetchAssets): the stage context from the
// build's collaborators, the staged `html:<hash>` url written back on the input, and the PNG (drawn at 2×)
// scaled to the layer's box unless the author set a scale.

import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import type Segment from '../../core/models/Segment';
import type { FontRequest } from '../../core/models/Segment';
import type { MapAnimationInput } from '@/core/types';
import { defaultHtmlFamily } from '@/core/html/html-fonts';
import { templateFontSpecs, type TemplateFontFace } from '@/core/html/template-fonts';
import { loadTemplateFonts } from '@/core/html/template-font-load';
import { registeredHtmlRasteriser, stageHtmlLayer, type HtmlLayerInput } from './stage-html-layer';

export interface HtmlAssetDeps {
  filesystem: AbstractFilesystem;
  logger: AbstractLogger;
  segment: Pick<Segment, 'panelsDir' | 'fontsDir' | 'currentSection'>;
  global: unknown;
  valueOf: (name: string) => string | undefined;
  stageFont: (request: FontRequest) => Promise<void>;
  /** The template's staged-media cache (url → path). */
  cache: Record<string, string>;
}

export type HtmlInputItem = MapAnimationInput & HtmlLayerInput;

// The template's own fonts are read once per render (its global), however many layers use them, and a
// failed read fails every layer the same way.
const TEMPLATE_FONTS = new WeakMap<object, Promise<TemplateFontFace[]>>();

function templateFonts(deps: HtmlAssetDeps): Promise<TemplateFontFace[]> {
  const specs = templateFontSpecs(deps.global);

  if (specs.length === 0 || deps.global === null || typeof deps.global !== 'object') return Promise.resolve([]);

  const loaded =
    TEMPLATE_FONTS.get(deps.global) ?? loadTemplateFonts(specs, (src) => deps.filesystem.readTemplateFont(src));

  TEMPLATE_FONTS.set(deps.global, loaded);

  return loaded;
}

// The PNG is drawn at 2×: scaled back to the box unless the author chose a scale. Authored inputs may
// omit options altogether (the schema has them optional).
function withBoxScale(
  options: Partial<MapAnimationInput['options']> | undefined,
  item: HtmlLayerInput
): MapAnimationInput['options'] {
  const scale = options?.scale ?? `${item.width ?? 0}:${item.height ?? 0}`;

  return { ...options, scale } as MapAnimationInput['options'];
}

export async function stageHtmlInput(item: HtmlInputItem, deps: HtmlAssetDeps): Promise<void> {
  const { filesystem, segment } = deps;
  const staged = await stageHtmlLayer(item, {
    filesystem,
    logger: deps.logger,
    dir: segment.panelsDir,
    section: segment.currentSection?.name ?? '',
    lookup: deps.valueOf,
    defaultFamily: defaultHtmlFamily(deps.global),
    loadFont: async (file) => {
      await deps.stageFont({ file });

      return filesystem.readFile(`${segment.fontsDir}/${file}`);
    },
    templateFonts: await templateFonts(deps),
    rasteriser: registeredHtmlRasteriser(),
  });

  item.url = staged.url;
  item.options = withBoxScale(item.options, item);
  deps.cache[staged.url] = staged.path;
}
