// Composites a section's emoji images over its frame. Each image is one `-loop 1 -i` still (the same
// source still-image `inputs` use), scaled to the emoji size on its own leg and overlaid at its
// measured position after the text it belongs to — after, so a caption's background box can't paint
// over it. Only scale/format/fade/colorchannelmixer/overlay: all on the LGPL on-device allowlist.
import type { EmojiOverlay } from './emoji-overlays';

export interface EmojiChain {
  /** filter_complex chains, in definition order. */
  chains: string[];
  /** The pad the composited frame leaves on. */
  out: string;
}

function overlayOptions(overlay: EmojiOverlay): string {
  const position = overlay.moving ? `x='${overlay.x}':y='${overlay.y}'` : `${overlay.x}:${overlay.y}`;

  return `${position}${overlay.enable}`;
}

/**
 * The chains compositing `overlays` onto pad `base`. Image `i` is input `firstInput + i`; pads are
 * prefixed so they never collide with the section's own labels.
 */
export function emojiOverlayChains(
  base: string,
  overlays: EmojiOverlay[],
  firstInput: number,
  prefix: string
): EmojiChain {
  const chains: string[] = [];
  let current = base;

  for (const [index, overlay] of overlays.entries()) {
    const leg = `${prefix}_emoji_${index}_src`;
    const out = `${prefix}_emoji_${index}`;
    const legFilters = [`scale=${overlay.size}:${overlay.size}`, 'format=rgba', ...overlay.leg];

    chains.push(`[${firstInput + index}:v]${legFilters.join(',')}[${leg}]`);
    chains.push(`[${current}][${leg}]overlay=${overlayOptions(overlay)}[${out}]`);
    current = out;
  }

  return { chains, out: current };
}

/**
 * Turns a linear `-vf` chain into a graph with the emoji composited after filter `splitAt` (the last
 * text that carried emoji): `[video]head[base]` → overlays → `[last]tail[out]`.
 */
export function linearWithEmoji(
  filters: string[],
  splitAt: number,
  video: string,
  overlays: { list: EmojiOverlay[]; firstInput: number; prefix: string }
): EmojiChain {
  const head = filters.slice(0, splitAt);
  const tail = filters.slice(splitAt);
  const base = `${overlays.prefix}_emoji_base`;
  const composite = emojiOverlayChains(base, overlays.list, overlays.firstInput, overlays.prefix);
  const chains = [`[${video}]${head.length > 0 ? head.join(',') : 'null'}[${base}]`, ...composite.chains];

  if (tail.length === 0) return { chains, out: composite.out };

  const out = `${overlays.prefix}_emoji_out`;

  return { chains: [...chains, `[${composite.out}]${tail.join(',')}[${out}]`], out };
}
