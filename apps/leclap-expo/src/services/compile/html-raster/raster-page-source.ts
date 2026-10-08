// The engine's HTML layer page (packages/ffmpeg-video-composer/dist/html-rasteriser.html, staged into
// assets/ by scripts/copy-core-assets.ts): one self-contained file, the WebAssembly inlined. The WebView
// opens it from its local file: handing its 5 MB to the WebView as an inline string through the bridge
// took the Android emulator 20 s to a minute, against about 2 s from the file.

import { Asset } from 'expo-asset';
import rasterPage from '@/assets/html-rasteriser/html-rasteriser.html';

export interface RasterPageFile {
  /** file:// URI of the page. */
  uri: string;
  /** Its directory: the only one the WebView may read (iOS). */
  directory: string;
}

let page: Promise<RasterPageFile> | undefined;

async function locate(): Promise<RasterPageFile> {
  const asset = await Asset.fromModule(rasterPage).downloadAsync();
  const uri = asset.localUri ?? asset.uri;

  return { uri, directory: uri.slice(0, uri.lastIndexOf('/') + 1) };
}

export function loadRasterPage(): Promise<RasterPageFile> {
  page ??= locate().catch((error: unknown) => {
    page = undefined;

    throw error;
  });

  return page;
}
