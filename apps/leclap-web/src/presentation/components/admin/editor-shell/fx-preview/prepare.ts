// One graphic → its live preview painter. Engine effects go through the engine's own context and plans
// (fx-context.ts, paint-*.ts); stroke graphics through the engine's stroke plans (paint-stroke.ts).
// Everything a painter needs is computed here, once per change of the graphic, so the
// per-frame work is drawing only.
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import type { FxEffectName } from 'ffmpeg-video-composer/src/schemas/fx-primitives.schemas.ts';
import type { AnyFxContext } from 'ffmpeg-video-composer/src/editor/presets/fx-kit.ts';
import { STROKE_DEFAULTS } from 'ffmpeg-video-composer/src/editor/presets/graphics-lines.ts';
import { frameOf, previewFxContext, seconds, type PreviewEnv } from './fx-context';
import { loopSpan } from './fx-time';
import { paintEdgeGlow, paintLeak, paintSheen, paintVignette } from './paint-light';
import { paintConfetti, paintGlint, paintRipple } from './paint-marks';
import { bloomSurface, glassSurface, paintBokeh, paintDust, paintGrain, resolveSurface } from './paint-texture';
import { strokePainter, type StrokeGraphic } from './paint-stroke';
import type { Box, FxPainter } from './painter';

type Parts = Pick<FxPainter, 'paint' | 'surface'>;

// Each primitive's drawing. The contexts are typed per primitive by the engine; the table is keyed by name.
const FX_PARTS: Record<FxEffectName, (fx: never) => Parts | null> = {
  sheen: (fx) => ({ paint: paintSheen(fx) }),
  leak: (fx) => ({ paint: paintLeak(fx) }),
  'edge-glow': (fx) => ({ paint: paintEdgeGlow(fx) }),
  'vignette-breathe': (fx) => ({ paint: paintVignette(fx) }),
  ripple: (fx) => nullable(paintRipple(fx)),
  glint: (fx) => nullable(paintGlint(fx)),
  confetti: (fx) => ({ paint: paintConfetti(fx) }),
  bokeh: (fx) => ({ paint: paintBokeh(fx) }),
  dust: (fx) => ({ paint: paintDust(fx) }),
  grain: (fx) => ({ paint: paintGrain(fx) }),
  glass: (fx) => ({ surface: glassSurface(fx) }),
  resolve: (fx) => ({ surface: resolveSurface(fx) }),
  bloom: (fx) => ({ surface: bloomSurface(fx) }),
};

/** Primitives the engine leaves out under reduced motion (their reduced form is "absent"). */
export const ABSENT_WHEN_REDUCED: ReadonlySet<FxEffectName> = new Set([
  'bokeh',
  'dust',
  'grain',
  'bloom',
  'vignette-breathe',
]);

function nullable(paint: FxPainter['paint'] | null): Parts | null {
  return paint ? { paint } : null;
}

function isWholeFrame(box: Box, env: PreviewEnv): boolean {
  const { width, height } = frameOf(env.orientation);

  return box.x <= 0 && box.y <= 0 && box.w >= width - 2 && box.h >= height - 2;
}

function prepareFx(graphic: Extract<Graphic, { type: 'fx' }>, index: number, env: PreviewEnv): FxPainter | null {
  const fx: AnyFxContext | null = previewFxContext(graphic, index, env);

  if (!fx) return null;

  const target: Box = { ...fx.target };
  const outline = isWholeFrame(target, env) ? null : target;
  // resolve owns the element's entrance: its glow holds from the section start.
  const from = graphic.effect === 'resolve' ? Math.max(0, fx.at - 0.6) : fx.at;
  const span = loopSpan(from, fx.end, env.sectionSeconds);

  if (fx.reduced && ABSENT_WHEN_REDUCED.has(graphic.effect)) return { span, outline, absent: true };

  const parts = FX_PARTS[graphic.effect](fx as never);

  return parts ? { span, outline, ...parts } : null;
}

function prepareStroke(g: StrokeGraphic, index: number, env: PreviewEnv): FxPainter | null {
  const stroke = strokePainter(g, index, env);

  if (!stroke) return null;

  const at = seconds(g.at, 0);
  const settled = at + (g.duration ?? STROKE_DEFAULTS[g.type].duration);
  const until = typeof g.until === 'number' && g.until < settled + 3 ? g.until : settled + 1.2;

  return { span: loopSpan(at, until, env.sectionSeconds), outline: stroke.box, paint: stroke.paint };
}

/** The live preview of `graphic` (section.graphics[index]), or null when the canvas has no preview for it. */
export function preparePainter(graphic: Graphic, index: number, env: PreviewEnv): FxPainter | null {
  if (graphic.type === 'fx') return prepareFx(graphic, index, env);

  if (graphic.type === 'frame' || graphic.type === 'corners' || graphic.type === 'underline') {
    return prepareStroke(graphic, index, env);
  }

  return null;
}
