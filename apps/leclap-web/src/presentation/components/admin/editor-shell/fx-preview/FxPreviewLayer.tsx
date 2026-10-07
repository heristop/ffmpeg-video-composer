// The live effect preview over the scene canvas: <canvas> layers the size of the frame on which the prepared
// painters draw at a section time, interleaved in authored order (stack.ts) with one DOM surface per effect
// built from the picture itself (glass, resolve, bloom: CSS backdrop filters over what is under them). On the edit canvas it loops the selected effect on its own clock
// (the window plus a short lead-in and tail); in playback the program clock drives it. Raw DOM writes per
// frame, no React state. Under reduced motion it draws one still frame of the primitive's reduced form.
// Loaded lazily (LazyFxPreview): the engine plans it pulls in stay out of the eager bundle.
import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { logger } from '@/lib/logger';
import { frameOf, type Frame, type PreviewEnv } from './fx-context';
import { loopTime } from './fx-time';
import { preparePainter } from './prepare';
import { stackOf, type Slot } from './stack';
import type { FxPainter, SurfaceLayer } from './painter';

export interface FxPreviewLayerProps {
  /** The section's graphics. */
  graphics: readonly Graphic[];
  /** Index of the one graphic to preview (the selected effect); omitted = every graphic. */
  only?: number;
  env: PreviewEnv;
  /** Section-time source (the program clock); omitted = the layer loops the effect on its own. */
  subscribe?: (paint: (t: number) => void) => () => void;
  /** Edit canvas: outline the target and show the "live preview" chip. */
  annotate?: boolean;
}

interface Prepared {
  painter: FxPainter;
  key: number;
}

function prepare(graphics: readonly Graphic[], only: number | undefined, env: PreviewEnv): Prepared[] {
  return graphics.flatMap((graphic, key) => {
    if (only !== undefined && key !== only) return [];

    try {
      const painter = preparePainter(graphic, key, env);

      return painter ? [{ painter, key }] : [];
    } catch (error) {
      logger.warn('Effect preview skipped:', error);

      return [];
    }
  });
}

function sizeCanvas(canvas: HTMLCanvasElement): void {
  const ratio = window.devicePixelRatio || 1;
  const [w, h] = [Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio)];

  if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
}

function backdropFilter(layer: SurfaceLayer, k: number): string {
  return [
    `blur(${(layer.blur * k).toFixed(2)}px)`,
    layer.saturate === undefined ? '' : `saturate(${layer.saturate})`,
    layer.contrast === undefined ? '' : `contrast(${layer.contrast})`,
    layer.brightness === undefined ? '' : `brightness(${layer.brightness})`,
  ].join(' ');
}

function writeSurface(el: HTMLDivElement | null, layer: SurfaceLayer | null, frame: Frame, k: number): void {
  if (!el) return;

  el.style.display = layer && layer.opacity > 0.003 ? '' : 'none';

  if (!layer) return;

  const { box } = layer;
  Object.assign(el.style, {
    left: `${(100 * box.x) / frame.width}%`,
    top: `${(100 * box.y) / frame.height}%`,
    width: `${(100 * box.w) / frame.width}%`,
    height: `${(100 * box.h) / frame.height}%`,
    borderRadius: `${(box.radius ?? 0) * k}px`,
    backdropFilter: backdropFilter(layer, k),
    background: surfaceBackground(layer),
    boxShadow: layer.rim ? `inset 0 1px 0 rgba(255, 255, 255, ${layer.rim})` : 'none',
    mixBlendMode: layer.blend ?? 'normal',
    opacity: String(Math.min(1, layer.opacity)),
  });
}

// The tint over the shade (a flat veil: unlike a backdrop brightness, it stays even up to the box edge,
// where a backdrop blur thins out).
function surfaceBackground(layer: SurfaceLayer): string {
  const layers = [layer.tint, layer.shade].filter(Boolean).map((color) => `linear-gradient(${color}, ${color})`);

  return layers.length > 0 ? layers.join(', ') : 'transparent';
}

interface Scene {
  /** The top canvas: it carries the outlines and its size drives the redraws. */
  canvas: HTMLCanvasElement;
  /** The DOM node of each slot (a canvas or a surface), by slot index. */
  nodes: Array<HTMLElement | null>;
  slots: Slot[];
  prepared: Prepared[];
  frame: Frame;
  /** The target outline colour (the brand token), or null when the layer does not annotate. */
  outline: string | null;
}

function outlineTarget(ctx: CanvasRenderingContext2D, painter: FxPainter, color: string, k: number): void {
  const box = painter.outline;

  if (!box) return;

  ctx.save();
  ctx.setLineDash([6 / k, 5 / k]);
  ctx.lineWidth = 1.25 / k;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, box.radius ?? 0);
  ctx.stroke();
  ctx.restore();
}

// A slot's canvas, cleared and scaled from output px to canvas px per axis: the frame's layers and boxes are
// placed in fractions of the frame, so the light lands on them even where the on-screen frame is not exactly
// the output aspect.
function canvasContext(canvas: HTMLCanvasElement, frame: Frame): CanvasRenderingContext2D | null {
  sizeCanvas(canvas);
  const ctx = canvas.getContext('2d');

  if (!ctx) return null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(canvas.width / frame.width, 0, 0, canvas.height / frame.height, 0, 0);

  return ctx;
}

// Runs one painter's part at `t`; a parameter the plan cannot draw yet (mid-edit) skips it for this frame.
function guarded(draw: () => void): void {
  try {
    draw();
  } catch {
    // Skipped: the next edit or frame draws it again.
  }
}

function drawSlot(scene: Scene, slot: Slot, node: HTMLElement | null, t: number): void {
  const { frame, prepared } = scene;

  if (slot.kind === 'surface') {
    const div = node instanceof HTMLDivElement ? node : null;
    const k = scene.canvas.clientWidth / frame.width;
    guarded(() => {
      writeSurface(div, prepared[slot.member].painter.surface?.(t) ?? null, frame, k);
    });

    return;
  }

  const ctx = node instanceof HTMLCanvasElement ? canvasContext(node, frame) : null;

  if (!ctx) return;

  for (const member of slot.members) {
    guarded(() => {
      prepared[member].painter.paint?.(ctx, t);
    });
  }
}

function drawAt(scene: Scene, t: number): void {
  for (const [i, slot] of scene.slots.entries()) drawSlot(scene, slot, scene.nodes[i] ?? null, t);

  const ctx = scene.outline ? scene.canvas.getContext('2d') : null;

  if (!ctx || !scene.outline) return;

  const k = scene.canvas.width / scene.frame.width;

  for (const { painter } of scene.prepared) outlineTarget(ctx, painter, scene.outline, k);
}

/** The span the canvas loops over: every previewed effect's span, merged. */
function loopOf(prepared: Prepared[]): [number, number] {
  const spans = prepared.map(({ painter }) => painter.span);

  return [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
}

interface PaintSetup {
  nodes: RefObject<Array<HTMLElement | null>>;
  slots: Slot[];
  prepared: Prepared[];
  orientation: PreviewEnv['orientation'];
  annotate: boolean;
  subscribe?: FxPreviewLayerProps['subscribe'];
  reduced: boolean;
  /** Which effect is looped: a new selection replays from the start, a parameter tweak keeps the phase. */
  loopKey?: number;
}

function brandColor(el: HTMLElement): string {
  return getComputedStyle(el).getPropertyValue('--color-brand-500').trim() || 'currentColor';
}

// Drives the drawing: the external clock when given, else a rAF loop over the effect's span (or one still
// frame under reduced motion, redrawn when the frame resizes).
function useFxPaint({ nodes, slots, prepared, orientation, annotate, subscribe, reduced, loopKey }: PaintSetup): void {
  const started = useRef<{ key?: number; at: number } | null>(null);

  useEffect(() => {
    const el = nodes.current[slots.length - 1];

    if (!(el instanceof HTMLCanvasElement) || prepared.length === 0) return idle;

    const outline = annotate ? brandColor(el) : null;
    const frame = frameOf(orientation);
    const scene: Scene = { canvas: el, nodes: nodes.current, slots, prepared, frame, outline };

    if (subscribe) {
      return subscribe((t) => {
        drawAt(scene, t);
      });
    }

    const span = loopOf(prepared);

    if (reduced) return still(scene, (span[0] + span[1]) / 2);

    // The loop keeps its phase across re-plans (tuning a parameter does not restart the effect); picking
    // another effect replays from the start.
    const previous = started.current;
    const loop = previous && previous.key === loopKey ? previous : { key: loopKey, at: performance.now() };
    started.current = loop;

    return runLoop(scene, span, loop.at);
  }, [nodes, slots, prepared, orientation, annotate, subscribe, reduced, loopKey]);
}

function idle(): void {
  // Nothing was started: no canvas yet, or nothing to draw.
}

/** Reduced motion: one frame at `t`, redrawn when the frame resizes; returns the stop function. */
function still(scene: Scene, t: number): () => void {
  const observer = new ResizeObserver(() => {
    drawAt(scene, t);
  });
  observer.observe(scene.canvas);

  return () => {
    observer.disconnect();
  };
}

/** Loops `span` of section time from `origin` (a performance.now() stamp); returns the stop function. */
function runLoop(scene: Scene, span: [number, number], origin: number): () => void {
  let frame = 0;
  const tick = (now: number) => {
    drawAt(scene, loopTime(span, (now - origin) / 1000));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
  };
}

function labelKey(prepared: Prepared[], reduced: boolean): string {
  if (prepared.length === 0) return 'animation.fx.livePreviewNone';

  return reduced || prepared.every(({ painter }) => painter.absent)
    ? 'animation.fx.livePreviewStill'
    : 'animation.fx.livePreview';
}

const FxPreviewLayer = ({ graphics, only, env, subscribe, annotate = false }: FxPreviewLayerProps) => {
  const { t } = useTranslation('admin');
  const nodes = useRef<Array<HTMLElement | null>>([]);
  const prepared = prepare(graphics, only, env);
  const slots = stackOf(prepared.map(({ painter }) => painter));
  useFxPaint({
    nodes,
    slots,
    prepared,
    orientation: env.orientation,
    annotate,
    subscribe,
    reduced: env.reduced,
    loopKey: only,
  });

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {slots.map((slot, i) => {
        const ref = (el: HTMLElement | null) => {
          nodes.current[i] = el;
        };

        return slot.kind === 'surface' ? (
          <div key={`s${prepared[slot.member].key}`} ref={ref} className="absolute" style={{ display: 'none' }} />
        ) : (
          <canvas key={`c${i}`} ref={ref} className="absolute inset-0 h-full w-full" />
        );
      })}
      {annotate ? (
        <span className="absolute top-2 left-2 rounded-full bg-black/50 px-1.5 py-0.5 text-[0.6rem] font-medium tracking-wide text-white/75 backdrop-blur-sm sm:px-2 sm:text-[0.65rem]">
          {t(labelKey(prepared, env.reduced))}
        </span>
      ) : null}
    </div>
  );
};

export default FxPreviewLayer;
