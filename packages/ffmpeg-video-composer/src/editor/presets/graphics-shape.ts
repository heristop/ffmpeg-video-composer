// packages/ffmpeg-video-composer/src/editor/presets/graphics-shape.ts
// The shape graphic as the graphics table (graphics.ts) sees it: its defaults and its resting footprint for
// the motion timeline. Its `render` hands the element to the compile path's lowering (shape-draw.ts, reached
// through SugarContext.masks.shapes like the strokes), so the rasteriser stays out of the browser's eager
// load; without that lowering (validation, timelines) it draws nothing.

import {
  BRAND,
  type Base,
  type Frame,
  type GraphicEnv,
  type GraphicWindow,
  type Rect,
  type Spec,
} from './graphics-spec';
import { SHAPE_DEFAULTS, shapeBounds, shapeOutline, type ShapeGraphic } from './shape-geometry';

function render(g: ShapeGraphic) {
  return (window: GraphicWindow, env: GraphicEnv) => {
    const site = env.site;
    const lower = site?.ctx.masks?.shapes;

    return site && lower ? lower({ graphic: g, ...window, seed: env.seed, ...site }) : [];
  };
}

// The footprint resolves a target only when it is the frame; any other target counts as the whole frame.
function footprintTarget(g: ShapeGraphic, frame: Frame): Rect | null {
  return g.target === undefined ? null : { x: 0, y: 0, w: frame.width, h: frame.height };
}

export function shapeSpec(g: ShapeGraphic, frame: Frame, base: Base): Spec {
  const commands = shapeOutline(g, frame, footprintTarget(g, frame), 0);
  const stroke = g.stroke ? (g.stroke.width ?? SHAPE_DEFAULTS.strokeWidth) : 0;
  const bounds = commands && shapeBounds(commands, stroke);

  return {
    ...base,
    duration: g.duration ?? (g.stroke?.draw ? SHAPE_DEFAULTS.drawDuration : SHAPE_DEFAULTS.duration),
    color: g.color ?? BRAND,
    rects: () => (bounds && bounds !== 'dense' ? [bounds] : []),
    render: render(g),
  };
}
