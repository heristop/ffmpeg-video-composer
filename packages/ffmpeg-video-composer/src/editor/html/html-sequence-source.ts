// How a staged HTML layer enters FFmpeg. A still card is a PNG held with `-loop 1`, like an image input. An
// animated card (stage-html-sequence.ts) is one animated PNG whose frame delays are its timestamps: it opens
// with a plain `-i` (the apng demuxer, built on Node, in the browser core and on the phone, plays it once from
// the section start) and its overlay repeats the last frame (MapManager), so the card holds its final state
// to the end of the section like a still. Start/duration still gate it through the overlay's `enable`.

import { assertSafeArgToken } from '@/core/arg-guard';
import { HTML_SEQUENCE_SCHEME } from '@/core/html/limits';
import { buildSingleFileImageSource } from '../utils/input-sources';

/** True for an html input the asset stage drew as an animated card. */
export function isHtmlSequence(input: { type?: string; url?: string }): boolean {
  return input.type === 'html' && (input.url ?? '').startsWith(HTML_SEQUENCE_SCHEME);
}

/** The `-i` source of a staged html layer at `path`. */
export function buildHtmlLayerSource(input: { type?: string; url?: string }, path: string): string {
  if (!isHtmlSequence(input)) return buildSingleFileImageSource(path);

  return `-i ${assertSafeArgToken(path, 'html sequence source')}`;
}
