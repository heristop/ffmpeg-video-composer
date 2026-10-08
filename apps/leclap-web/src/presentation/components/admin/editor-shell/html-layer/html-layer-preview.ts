// The builder's live preview of an HTML layer: the engine's own rasteriser (renderHtmlLayerPreview, the same
// Satori + resvg pipeline a render uses) fed the template's theme and values, the bundled fonts the app
// serves and its self-hosted WebAssembly. The engine loads on the first preview only (dynamic import), and
// a layer already drawn comes back from a small cache of blob URLs.
import type { HtmlLayerFinding } from 'ffmpeg-video-composer/src/browser.ts';
import { loadSelfHostedHtmlWasm } from '@/infrastructure/html-engine';
import type { HtmlLayer } from '../../templateEditorModel';
import type { HtmlPreviewEnv } from './html-layer-env';

export interface HtmlLayerPreviewResult {
  /** A blob URL of the transparent PNG (the box at the render's density). */
  url: string;
  findings: HtmlLayerFinding[];
}

export const PREVIEW_CACHE_SIZE = 24;

const previews = new Map<string, Promise<HtmlLayerPreviewResult>>();
const fonts = new Map<string, Promise<Uint8Array>>();

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url);

  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}

function loadFont(file: string): Promise<Uint8Array> {
  const cached = fonts.get(file);

  if (cached) return cached;

  const loading = fetchBytes(`/fonts/${file}`).then((bytes) => {
    if (!bytes) throw new Error(`font ${file} is not served`);

    return bytes;
  });

  fonts.set(file, loading);
  loading.catch(() => fonts.delete(file));

  return loading;
}

function dataUri(bytes: Uint8Array, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('could not read the image'));
    };
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type }));
  });
}

const IMAGE_TYPES: Partial<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

// Template images are the app's served assets (the engine refuses remote ones): PNG or JPEG only.
async function readImage(ref: string): Promise<string | null> {
  const type = IMAGE_TYPES[ref.split('.').pop()?.toLowerCase() ?? ''];

  if (!type) return null;

  const bytes = await fetchBytes(ref.startsWith('/assets/') ? ref : `/assets/${ref.replace(/^\.?\//, '')}`);

  return bytes ? dataUri(bytes, type) : null;
}

async function draw(layer: HtmlLayer, env: HtmlPreviewEnv): Promise<HtmlLayerPreviewResult> {
  const { renderHtmlLayerPreview } = await import('ffmpeg-video-composer/src/browser.ts');
  const preview = await renderHtmlLayerPreview(
    {
      html: layer.html,
      css: layer.css,
      width: layer.width,
      height: layer.height,
      global: env.global,
      values: env.values,
      loadFont,
      readImage,
    },
    { loadHtmlWasm: loadSelfHostedHtmlWasm }
  );
  const url = URL.createObjectURL(new Blob([new Uint8Array(preview.png)], { type: 'image/png' }));

  return { url, findings: preview.findings };
}

function forget(key: string): void {
  const evicted = previews.get(key);

  previews.delete(key);
  evicted?.then(
    ({ url }) => {
      URL.revokeObjectURL(url);
    },
    () => {}
  );
}

/** The layer drawn as the render draws it, with what the render would report about it. */
export function previewHtmlLayer(layer: HtmlLayer, env: HtmlPreviewEnv): Promise<HtmlLayerPreviewResult> {
  const key = JSON.stringify([layer.html, layer.css ?? '', layer.width, layer.height, env.global, env.values]);
  const cached = previews.get(key);

  if (cached) return cached;

  const drawing = draw(layer, env);

  previews.set(key, drawing);
  drawing.catch(() => previews.delete(key));

  if (previews.size > PREVIEW_CACHE_SIZE) forget(previews.keys().next().value as string);

  return drawing;
}
