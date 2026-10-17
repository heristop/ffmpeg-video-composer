// Pure per-frame sampling of a cross-scene transition for the live program monitor. The engine's
// xfade runs on the GPU/CPU at render; the preview approximates each PreviewFamily with inline
// opacity/transform/clip-path styles sampled at the blend progress (0 = outgoing fully visible,
// 1 = incoming fully visible). Inline styles (not @keyframes) because the clock scrubs both ways.
import type { PreviewFamily } from '../editor/transitionGroups';

export interface BlendLayerStyle {
  opacity?: number;
  transform?: string;
  clipPath?: string;
  filter?: string;
}

export interface BlendStyle {
  outgoing: BlendLayerStyle;
  incoming: BlendLayerStyle;
}

const clamp01 = (p: number): number => Math.min(1, Math.max(0, p));

// Sample one family at `progress`. Unknown families fall back to a plain crossfade — the safest
// visual for the many xfade variants a family bucket approximates.
export function transitionBlendAt(family: PreviewFamily, progress: number): BlendStyle {
  const p = clamp01(progress);

  switch (family) {
    case 'wipe':
      return { outgoing: {}, incoming: { clipPath: `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)` } };
    case 'slide':
      return {
        outgoing: { transform: `translateX(${(-p * 100).toFixed(2)}%)` },
        incoming: { transform: `translateX(${((1 - p) * 100).toFixed(2)}%)` },
      };
    case 'cover':
      return { outgoing: {}, incoming: { transform: `translateX(${((1 - p) * 100).toFixed(2)}%)` } };
    case 'circle':
      return { outgoing: {}, incoming: { clipPath: `circle(${(p * 75).toFixed(2)}% at 50% 50%)` } };
    case 'slice':
      return { outgoing: {}, incoming: { clipPath: `inset(0 0 ${((1 - p) * 100).toFixed(2)}% 0)` } };
    case 'reveal':
      return { outgoing: {}, incoming: { clipPath: `inset(0 0 0 ${((1 - p) * 100).toFixed(2)}%)` } };
    case 'zoom':
      return {
        outgoing: { opacity: 1 - p, transform: `scale(${(1 + p * 0.2).toFixed(3)})` },
        incoming: { opacity: p },
      };
    case 'blur':
      return {
        outgoing: { opacity: 1 - p, filter: `blur(${(p * 12).toFixed(1)}px)` },
        incoming: { opacity: p, filter: `blur(${((1 - p) * 12).toFixed(1)}px)` },
      };
    case 'pixel':
      return {
        outgoing: { opacity: 1 - p, filter: `contrast(${(1 + p * 0.4).toFixed(2)})` },
        incoming: { opacity: p, filter: `contrast(${(1 + (1 - p) * 0.4).toFixed(2)})` },
      };
    default:
      return { outgoing: { opacity: 1 - p }, incoming: { opacity: p } };
  }
}
