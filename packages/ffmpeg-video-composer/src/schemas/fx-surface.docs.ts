// The prose of the glass and resolve rows (fx-surface.schemas.ts): a row of FX_DOCS each (fx-docs.ts).
import type { FxDoc } from './fx-primitives.schemas';
import type { glass, resolve } from './fx-surface.schemas';

export const glassDoc = {
  params: {
    tone: 'dark: smoked glass for light text (its brightest point stays dark enough for white text at ≥ 4.5:1); light: milk glass for dark text (its darkest point stays light enough for #1A1A1A text at ≥ 4.5:1). Default dark.',
    frost:
      "Frost blur σ as a share of the card's short side (default ~0.08–0.12, at most 40 px): 0.03 = clear glass, 0.2 = heavy frost where nothing behind is legible.",
    saturation: 'Colour kept from what is behind the glass (default ~0.45–0.65): 0 = neutral grey glass.',
    highlight:
      'Strength of the top-lit edge highlight (a 1 px rim, 2 px from a 1080 px short side; default ~0.6–0.85, peaking at 0.35 alpha at 1). 0 = no rim.',
    ramp: 'Seconds the card takes to frost in and to clear out (default 0.3, at least 4 frames).',
  },
  intent: {
    summary:
      'A frosted glass panel on the target rectangle (blurred, toned and desaturated footage behind it, a top-lit edge, rounded corners from the target radius) that keeps the text on it legible: a lower third, a name card or a caption plate.',
    useWhen: 'text sits over footage or a busy photo and needs a plate that still shows the scene',
    avoidWhen: 'flat colour backgrounds (a plain card is cleaner); more than one glass panel per beat',
    vary: 'tone (smoked or milk), frost (clear to heavy), saturation, colour + intensity (tint toward the theme), highlight (edge light), ramp (how it lands); the target radius sets the corners. Duration is how long it stays.',
    reduced: 'unchanged (it does not move; it still frosts in and out over its ramp)',
  },
} satisfies FxDoc<(typeof glass)['params']>;

export const resolveDoc = {
  params: {
    blur: "Starting defocus σ as a share of the target's short side (default ~0.035–0.055, e.g. 8 px on a 180 px logo box), eased to 0 frame by frame.",
    scale: 'Starting scale, settling to 1 (default 1.03–1.05). 1 = no scale.',
    fade: 'Share of the duration the element takes to become opaque (default 0.55).',
  },
  intent: {
    summary:
      'A logo or title resolves into place: the target region starts defocused, slightly enlarged and dissolved into a soft glow of itself, then sharpens (per-frame blur steps, no visible step), settles to scale 1 and becomes opaque. Before `at` the target shows that glow.',
    useWhen: 'an intro logo, a brand lock-up or a one-word title lands on a calm card',
    avoidWhen:
      'text that already has a kinetic entrance (pick one); over moving footage (the region is processed as a rectangle with a feathered edge)',
    vary: 'blur and scale set how far out of focus it starts (intensity 0..1 scales both); fade sets when it becomes solid; duration and ease set the landing ($expo crisp, $gentle soft); target a layer:<i> or a rectangle around the logo.',
    reduced: 'a plain cross-fade from the glow into the sharp element (no defocus steps, no scale)',
  },
} satisfies FxDoc<(typeof resolve)['params']>;
