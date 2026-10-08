// The messages between a host and a page that draws HTML layers out of process (the phone's hidden
// WebView: Hermes has no WebAssembly). Everything crosses as JSON text, bytes as base64. A session is one
// page's lifetime: each font travels once, the page keeps it, later requests name it by key.

import { base64ToBytes, bytesToBase64 } from '../../editor/html/base64';
import type { LayerElement } from './html-element';
import type { HtmlRaster, HtmlRasterRequest } from './html-rasteriser';

export interface WireFont {
  family: string;
  file: string;
  weights: number[];
  /** Identity of the bytes within a session. */
  key: string;
  /** base64, on the first request of the session that uses this font only. */
  data?: string;
}

export interface RasterRenderMessage {
  type: 'render';
  id: number;
  element: LayerElement;
  width: number;
  height: number;
  density: number;
  fonts: WireFont[];
}

export type RasterPageReply =
  | { type: 'ready'; version: string }
  | { type: 'rendered'; id: number; png: string; contentHeight: number; ms: number }
  | { type: 'failed'; id?: number; message: string };

export interface RasterSession {
  /** The message for a request; fonts this session already sent go by key. */
  message(request: HtmlRasterRequest): RasterRenderMessage;
}

export function createRasterSession(): RasterSession {
  const sent = new Set<string>();
  let next = 0;

  return {
    message(request) {
      const fonts = request.fonts.map((font): WireFont => {
        const key = `${font.file}:${font.data.byteLength}`;
        const wire = { family: font.family, file: font.file, weights: font.weights, key };

        if (sent.has(key)) return wire;

        sent.add(key);

        return { ...wire, data: bytesToBase64(font.data) };
      });
      const { element, width, height, density } = request;

      next += 1;

      return { type: 'render', id: next, element, width, height, density, fonts };
    },
  };
}

/** The raster a `rendered` reply carries; any other reply throws its message. */
export function readRasterReply(reply: RasterPageReply): HtmlRaster {
  if (reply.type === 'failed') throw new Error(`HTML layer page: ${reply.message}`);

  if (reply.type !== 'rendered') throw new Error(`HTML layer page: unexpected ${reply.type} reply`);

  return { png: base64ToBytes(reply.png), contentHeight: reply.contentHeight };
}

/** Resolves a message's fonts against those the page holds, storing new ones, or the file of one it never received. */
export function receiveFonts(
  message: RasterRenderMessage,
  store: Map<string, Uint8Array>
): HtmlRasterRequest['fonts'] | string {
  const missing = message.fonts.find((font) => font.data === undefined && !store.has(font.key));

  if (missing) return missing.file;

  return message.fonts.map((font) => {
    const data = store.get(font.key) ?? base64ToBytes(font.data ?? '');
    store.set(font.key, data);

    return { family: font.family, file: font.file, weights: font.weights, data };
  });
}
