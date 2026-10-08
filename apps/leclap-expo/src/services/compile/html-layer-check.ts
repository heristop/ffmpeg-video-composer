// The on-device check of HTML layers (leclap://ffmpeg-spike?check=html): compiles the html-card sample, its
// layers drawn in the hidden WebView, and reports each layer's time and whether its PNG is byte-identical
// to the one Node draws (packages/ffmpeg-video-composer/tests/html-card-sample.test.ts holds the same hashes).

import * as FileSystem from 'expo-file-system/legacy';
import { sha256Hex } from 'ffmpeg-video-composer/src/core/determinism/sha256.ts';
import htmlCard from '../../../../../examples/motion-design/html-card.json';
import { compileOnDevice } from './compileOnDevice';
import { htmlRasterHost } from './html-raster/html-raster-host';

/** Node's PNG of each html-card layer, by box size. */
export const HTML_CARD_GOLDENS: Readonly<Record<string, string>> = {
  '608×264': '81878beedd5f47aee0bc479bf077c7628e8d93514a18d008fba89cb796abfa9d',
  '300×120': '506c9036f95d8fe5267ebedde0f8be3e05eb5845238b0a3ac6403b775f033485',
  '588×184': 'fbce55fa1a1d932d52a5f62b13fb37d4d49ee16fbd2b49c6e702bedd291cf0db',
  '588×224': 'b3bbd1f41de08076b56cac890e52f00b75d46286c151c5f38fd5099221d75a49',
  '480×72': '1a74c1668f4f450be870d094c588e93b2e5153b7e0e1026a9a18e5abc47ea604',
  '648×234': '8f1aaa3d2364021184c0b8c794e96e035368850c12156be73c7d1aeb2f811387',
};

export interface CheckedLayer {
  size: string;
  ms: number;
  pageMs: number;
  /** Byte-identical to Node's PNG of the same layer. */
  golden: boolean;
}

export interface HtmlLayerCheck {
  outputUri: string;
  /** Mount to `ready` of the WebView page. */
  pageLoadMs: number | null;
  layers: CheckedLayer[];
}

// The app stages bundled backgrounds from their canonical /assets/backgrounds/ path, which the sample
// already uses; a photo named relative to the CLI's assets dir is moved under it.
function onDevice(descriptor: typeof htmlCard): typeof htmlCard {
  const sections = descriptor.sections.map((section) => {
    const { pictureUrl } = section.options;

    return {
      ...section,
      options: {
        ...section.options,
        pictureUrl: pictureUrl.startsWith('/assets/') ? pictureUrl : `/assets/${pictureUrl}`,
      },
    };
  });

  return { ...descriptor, sections };
}

export async function runHtmlLayerCheck(append: (line: string) => void): Promise<HtmlLayerCheck> {
  const hashes: { size: string; sha: string }[] = [];
  const stop = htmlRasterHost.observe((request, raster) => {
    hashes.push({ size: `${request.width}×${request.height}`, sha: sha256Hex(raster.png) });
  });
  const before = htmlRasterHost.timings().length;

  append('Compiling the html-card sample (its HTML layers drawn in the hidden WebView)…');
  // Layers an earlier run staged are reused by hash (the build's panels): drop them so this run draws.
  // Within one app session the engine also remembers drawn layers, so only the first run is cold.
  await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}leclap-build/panels`, { idempotent: true });

  try {
    const result = await compileOnDevice(onDevice(structuredClone(htmlCard)), {}, { qualityTier: 'draft' });

    if (!result.success || !result.outputUri) throw new Error(result.error ?? 'HTML layer compile produced no output');

    const timings = htmlRasterHost.timings().slice(before);
    const layers = hashes.map(({ size, sha }, index) => ({
      size,
      ms: timings[index]?.ms ?? 0,
      pageMs: timings[index]?.pageMs ?? 0,
      golden: HTML_CARD_GOLDENS[size] === sha,
    }));
    const check = { outputUri: result.outputUri, pageLoadMs: htmlRasterHost.pageLoadMs(), layers };

    append(`Page ready in ${check.pageLoadMs ?? '?'} ms`);

    if (layers.length === 0) append('No layer drawn: all came from the engine’s memory of this session.');

    for (const layer of layers) {
      const verdict = layer.golden ? '✅ same bytes as Node' : '❌ differs from Node';
      append(`${layer.size}: ${layer.ms} ms (page ${layer.pageMs} ms) ${verdict}`);
    }

    console.info('[html-layer-check]', JSON.stringify(check));

    return check;
  } finally {
    stop();
  }
}
