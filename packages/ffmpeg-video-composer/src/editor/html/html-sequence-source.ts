// Whether a staged HTML layer is an animated card. A still card is a PNG held with `-loop 1`, like an image
// input. An animated card (stage-html-sequence.ts) is one animated PNG whose frame delays are its timestamps:
// it opens with a plain `-i` (buildHtmlLayerSource, utils/input-sources.ts) and its overlay repeats the last
// frame (MapManager), so the card holds its final state to the end of the section like a still.

import { HTML_SEQUENCE_SCHEME } from '@/core/html/limits';

/** True for an html input the asset stage drew as an animated card. */
export function isHtmlSequence(input: { type?: string; url?: string }): boolean {
  return input.type === 'html' && (input.url ?? '').startsWith(HTML_SEQUENCE_SCHEME);
}
