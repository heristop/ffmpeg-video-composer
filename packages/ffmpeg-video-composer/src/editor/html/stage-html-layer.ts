// The asset stage of an HTML layer (`inputs[]` of `type: "html"`): its placeholders filled (HTML-escaped),
// the layer prepared (core/html), its images read from the template's assets and inlined, its fonts
// staged through the engine's font ladder, then drawn by the host's rasteriser into a transparent PNG under
// the build FS, named by content hash (`html:<hash>`), like the generated `panel:` and `sprite:` images.
// The overlay path composites it as a still image, so position, scale and motion work unchanged.

import { container } from 'tsyringe';
import type AbstractFilesystem from '../../platform/filesystem/AbstractFilesystem';
import type AbstractLogger from '../../platform/logging/AbstractLogger';
import { HTML_LAYER_DENSITY, htmlLayerKey, inlineImages, type PreparedHtmlLayer } from '@/core/html/html-layer';
import { HTML_RASTERISER, type HtmlRasteriser, type RasterFont } from '@/core/html/html-rasteriser';
import { overflowFinding, prepareWithFindings } from '../../services/html-raster/html-layer-findings';
import { bytesToBase64 } from './base64';

export interface HtmlLayerInput {
  name: string;
  html?: string;
  css?: string;
  width?: number;
  height?: number;
}

export interface HtmlStageContext {
  filesystem: Pick<AbstractFilesystem, 'stat' | 'writeFile' | 'readFile' | 'resolveLocalAsset'>;
  logger: AbstractLogger;
  /** Where generated images are staged (the segment's panelsDir). */
  dir: string;
  section: string;
  /** A render-time value (global.variables, form fields) for a placeholder name. */
  lookup: (name: string) => string | undefined;
  /** The CSS family text falls back to (the theme's body font). */
  defaultFamily: string;
  /** The bytes of a registry font file, staged through the engine's font sources. */
  loadFont: (file: string) => Promise<Uint8Array>;
  rasteriser: HtmlRasteriser | null;
  /** Rendered layers kept across renders by hash (default: one per process). */
  memory?: Map<string, Uint8Array>;
}

export interface StagedHtmlLayer {
  url: string;
  path: string;
}

/** Layers rendered by this process, by hash: a long-lived host (the MCP server) re-renders none. */
const PROCESS_MEMORY = new Map<string, Uint8Array>();
const PROCESS_MEMORY_LIMIT = 32;

const IMAGE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

/** The rasteriser the host registered, or null where HTML layers cannot be drawn yet. */
export function registeredHtmlRasteriser(): HtmlRasteriser | null {
  return container.isRegistered(HTML_RASTERISER) ? container.resolve<HtmlRasteriser>(HTML_RASTERISER) : null;
}

async function readImage(ref: string, ctx: HtmlStageContext): Promise<string | null> {
  if (ref.startsWith('data:')) return ref;

  const type = IMAGE_TYPES[ref.split('.').pop()?.toLowerCase() ?? ''] as string | undefined;
  const local = type ? await ctx.filesystem.resolveLocalAsset(ref) : null;

  if (!type || !local) {
    ctx.logger.warn(`[${ctx.section}][Html] image ${ref} skipped: not a PNG or JPEG among the template's assets`);

    return null;
  }

  return `data:${type};base64,${bytesToBase64(await ctx.filesystem.readFile(local))}`;
}

async function imageMap(refs: string[], ctx: HtmlStageContext): Promise<Map<string, string>> {
  const read = await Promise.all(refs.map(async (ref) => [ref, await readImage(ref, ctx)] as const));

  return new Map(read.filter((entry): entry is readonly [string, string] => entry[1] !== null));
}

function prepare(input: HtmlLayerInput, ctx: HtmlStageContext): PreparedHtmlLayer {
  const { prepared, findings } = prepareWithFindings(input, ctx.lookup, ctx.defaultFamily);

  for (const finding of findings) ctx.logger.warn(`[${ctx.section}][Html] ${finding.code}: ${finding.message}`);

  return prepared;
}

function remember(memory: Map<string, Uint8Array>, key: string, png: Uint8Array): void {
  memory.set(key, png);

  if (memory.size > PROCESS_MEMORY_LIMIT) memory.delete(memory.keys().next().value as string);
}

async function draw(
  request: Parameters<HtmlRasteriser['render']>[0],
  rasteriser: HtmlRasteriser,
  ctx: HtmlStageContext
): Promise<Uint8Array> {
  const raster = await rasteriser.render(request);

  for (const finding of overflowFinding(raster.contentHeight, request.height)) {
    ctx.logger.warn(`[${ctx.section}][Html] ${finding.code}: ${finding.message}`);
  }

  return raster.png;
}

/** Renders (or reuses) the layer's PNG under `ctx.dir`; returns its `html:<hash>` url and staged path. */
export async function stageHtmlLayer(input: HtmlLayerInput, ctx: HtmlStageContext): Promise<StagedHtmlLayer> {
  const { rasteriser } = ctx;

  if (!rasteriser) {
    throw new Error(
      `[${ctx.section}][Html] html_unavailable: input "${input.name}" is an HTML layer, which this engine cannot draw`
    );
  }

  const prepared = prepare(input, ctx);
  const element = inlineImages(prepared.element, await imageMap(prepared.imageRefs, ctx));
  const width = input.width ?? 0;
  const height = input.height ?? 0;
  const faces = prepared.faces.map((face) => `${face.file}@${face.weights.join('/')}`);
  const key = htmlLayerKey({ element, fonts: faces, width, height, renderer: rasteriser.version });
  const path = `${ctx.dir}/html-${key}.png`;
  const staged = { url: `html:${key}`, path };

  if (await ctx.filesystem.stat(path)) return staged;

  const memory = ctx.memory ?? PROCESS_MEMORY;
  const fonts: RasterFont[] = await Promise.all(
    prepared.faces.map(async (face) => ({ ...face, data: await ctx.loadFont(face.file) }))
  );
  const png =
    memory.get(key) ?? (await draw({ element, width, height, density: HTML_LAYER_DENSITY, fonts }, rasteriser, ctx));

  remember(memory, key, png);
  await ctx.filesystem.writeFile(path, png);
  ctx.logger.info(`[${ctx.section}][Html] staged ${input.name} as html-${key}.png`);

  return staged;
}
