// The page side of the out-of-process rasteriser (raster-messages.ts): takes a render message as JSON text,
// draws it with the page's rasteriser and replies with JSON text. The fonts a session sent stay here. The
// page hands in its clock: the time a layer took is a measurement, never part of what is drawn.

import { bytesToBase64 } from '@/editor/html/base64';
import type { HtmlRasteriser } from './html-rasteriser';
import { receiveFonts, type RasterPageReply, type RasterRenderMessage } from './raster-messages';

function failure(error: unknown, id?: number): RasterPageReply {
  return { type: 'failed', id, message: error instanceof Error ? error.message : String(error) };
}

/** Milliseconds from an arbitrary origin, for the time a layer took. */
export type RasterPageClock = () => number;

async function draw(
  message: RasterRenderMessage,
  rasteriser: HtmlRasteriser,
  fonts: Map<string, Uint8Array>,
  clock: RasterPageClock
): Promise<RasterPageReply> {
  const received = receiveFonts(message, fonts);

  if (typeof received === 'string') return failure(`font ${received} was not sent`, message.id);

  const started = clock();
  const { element, width, height, density, id } = message;
  const raster = await rasteriser.render({ element, width, height, density, fonts: received });

  return {
    type: 'rendered',
    id,
    png: bytesToBase64(raster.png),
    contentHeight: raster.contentHeight,
    ms: clock() - started,
  };
}

/** A handler for the page's incoming messages; `reply` posts JSON text back to the host. */
export function createRasterPage(
  rasteriser: HtmlRasteriser,
  reply: (text: string) => void,
  clock: RasterPageClock
): (text: string) => Promise<void> {
  const fonts = new Map<string, Uint8Array>();

  return async (text) => {
    let message: Partial<RasterRenderMessage> | undefined;

    try {
      message = JSON.parse(text) as Partial<RasterRenderMessage>;

      if (message.type !== 'render') return;

      reply(JSON.stringify(await draw(message as RasterRenderMessage, rasteriser, fonts, clock)));
    } catch (error) {
      reply(JSON.stringify(failure(error, message?.id)));
    }
  };
}
