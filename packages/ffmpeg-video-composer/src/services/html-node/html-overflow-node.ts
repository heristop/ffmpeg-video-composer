// html_overflow, measured: each HTML layer laid out (Satori, no raster) at its box width with real fonts,
// its natural height compared with the box. Node-only, like the rest of the geometry measurement
// (node-geometry.ts appends these). Images are left out of the measurement (the advisory then says it is
// approximate); placeholders keep the values a dry run knows (field defaults, global.variables).

import { defaultHtmlFamily } from '@/core/html/html-fonts';
import { fillHtmlPlaceholders, inlineImages, prepareHtmlLayer } from '@/core/html/html-layer';
import type { RasterFont } from '@/core/html/html-rasteriser';
import { declaredFontFaces, templateFontSpecs, type CustomFontFace } from '@/core/html/template-fonts';
import { resolveThemeDescriptor } from '@/core/theme/resolve';
import type { TemplateDescriptor } from '../../schemas/template.schemas';
import { withFieldDefaults } from '../field-advisories';
import type { FontLoader } from '../geometry/bundled-font-loader';
import type { GeometryWarning } from '../geometry/rules';
import { htmlInputs, type HtmlInputUse } from '../html-validation';
import { measureHtmlContent } from './html-rasteriser-node';

type Bag = Record<string, unknown>;

function variablesOf(global: unknown): Record<string, string> {
  const variables = (global as { variables?: Record<string, string | string[]> } | undefined)?.variables ?? {};

  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])
  );
}

async function fontsFor(faces: { family: string; file: string; weights: number[] }[], loadFont: FontLoader) {
  const loaded = await Promise.all(faces.map(async (face) => ({ ...face, data: await loadFont(face.file) })));

  return loaded.every((font) => font.data !== null) ? (loaded as RasterFont[]) : null;
}

async function overflowOf(
  use: HtmlInputUse,
  context: { family: string; variables: Record<string, string>; loadFont: FontLoader; custom: CustomFontFace[] }
): Promise<GeometryWarning[]> {
  const { input } = use;
  const width = typeof input.width === 'number' ? input.width : 0;
  const height = typeof input.height === 'number' ? input.height : 0;
  const html = fillHtmlPlaceholders(
    typeof input.html === 'string' ? input.html : '',
    (name) => context.variables[name]
  );
  const css = typeof input.css === 'string' ? input.css : '';
  // A template face is laid out under its own family; its bytes are not read here, so a layer using one is
  // not measured (no overflow guessed from a stand-in face).
  const prepared = prepareHtmlLayer({ html: html.html, css, width, height }, context.family, context.custom);
  const fonts = await fontsFor(prepared.faces, context.loadFont);

  if (!fonts || width <= 0 || height <= 0) return [];

  const element = inlineImages(prepared.element, new Map());
  const content = await measureHtmlContent({ element, width, height, fonts });

  if (content <= height + 1) return [];

  return [
    {
      path: `${use.path}.height`,
      code: 'html_overflow',
      message: `html layer content is ${Math.round(content)} px tall in its ${height} px box: the bottom is cut`,
      severity: 'warn',
      approx: prepared.imageRefs.length > 0,
    },
  ];
}

/** html_overflow for every HTML layer whose content is taller than its box. */
export async function htmlOverflowWarnings(
  descriptor: TemplateDescriptor,
  loadFont: FontLoader
): Promise<GeometryWarning[]> {
  if (htmlInputs(descriptor).length === 0) return [];

  const resolved = resolveThemeDescriptor(withFieldDefaults(descriptor)) as Bag;
  const context = {
    family: defaultHtmlFamily(resolved.global),
    variables: variablesOf(resolved.global),
    loadFont,
    custom: declaredFontFaces(templateFontSpecs(resolved.global)),
  };
  const found = await Promise.all(htmlInputs(resolved).map((use) => overflowOf(use, context)));

  return found.flat();
}
