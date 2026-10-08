// A draggable/resizable/rotatable IMAGE, ANIMATION or HTML layer box on the center SectionCanvas. It is
// presentational: position/scale/opacity/rotation come from the overlay `value`, the media URL is
// pre-resolved by the parent, and every geometry decision is delegated to imageAnimationDrag.ts (the
// same math the legacy AnimationFrameCanvas uses). Pointer-drag on the body moves it; when active a
// corner grip resizes and a top grip rotates, mirroring AnimationFrameCanvas's begin/beginRotate.
import { type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { AnimationOverlay, ImageOverlay, Orientation, OverlayFlip } from '../templateEditorModel';
import { FRAME_SIZE } from '../editor/animationOverlay';
import { AnimationMedia } from '../editor/AnimationMedia';
import { flipCssTransform } from '@leclap/creative-kit/editor';
import { moveOverlay, nudgeOverlay, resizeOverlay, resolveOverlayRect, rotateOverlay } from './imageAnimationDrag';

// Arrow-key nudge step (output px); Shift jumps further. Mirrors AnimationFrameCanvas's 8/40 steps.
const STEP = 8;
const STEP_FAST = 40;

// The geometry a box reads: an image, an animation, or an HTML layer's drawn still.
type MediaOverlay = Pick<ImageOverlay | AnimationOverlay, 'position' | 'scale' | 'rotation' | 'flip' | 'opacity'>;

interface MediaBoxProps {
  value: MediaOverlay;
  url: string;
  kind: 'image' | 'animation' | 'html';
  orientation: Orientation;
  active: boolean;
  frameRect: () => DOMRect | undefined;
  onSelect: () => void;
  onMove: (patch: { position: string }) => void;
  onResize: (patch: { scale: string }) => void;
  onRotate: (patch: { rotation: number }) => void;
  onNudge: (patch: { position: string }) => void;
  onDelete: () => void;
}

// Display px per output px: the on-screen frame width divided by the output frame width (k in the
// legacy canvas). Falls back to 1 before the frame is measured so a server render stays finite.
function scaleFactor(frameRect: () => DOMRect | undefined, orientation: Orientation): number {
  const width = frameRect()?.width;

  if (!width) return 1;

  return width / FRAME_SIZE[orientation].w;
}

export const SectionCanvasMediaBox = (props: MediaBoxProps) => {
  const { value, url, kind, orientation, active, frameRect } = props;
  const { t } = useTranslation('admin');

  // AnimationMedia doesn't surface the natural media size, so the box resolves against null — the drag
  // adapter then falls back to the output frame size, exactly as resolveOverlayRect documents.
  const rect = resolveOverlayRect(value.position, value.scale, null, orientation);
  const k = scaleFactor(frameRect, orientation);

  const beginMove = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onSelect();
    const start = { x: e.clientX, y: e.clientY };

    const onMove = (ev: PointerEvent) => {
      const patch = moveOverlay({
        baseX: rect.left,
        baseY: rect.top,
        deltaX: (ev.clientX - start.x) / k,
        deltaY: (ev.clientY - start.y) / k,
        width: rect.width,
        height: rect.height,
        orientation,
      });
      props.onMove(patch);
    };
    listenUntilUp(onMove);
  };

  const beginResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };

    const onMove = (ev: PointerEvent) => {
      const patch = resizeOverlay({
        baseW: rect.width,
        baseH: rect.height,
        deltaX: (ev.clientX - start.x) / k,
        deltaY: (ev.clientY - start.y) / k,
        orientation,
      });
      props.onResize(patch);
    };
    listenUntilUp(onMove);
  };

  const beginRotate = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = frameRect();

    if (!box) return;

    const center = {
      x: box.left + (rect.left + rect.width / 2) * k,
      y: box.top + (rect.top + rect.height / 2) * k,
    };

    const onMove = (ev: PointerEvent) => {
      const patch = rotateOverlay({
        centerX: center.x,
        centerY: center.y,
        clientX: ev.clientX,
        clientY: ev.clientY,
        snap: ev.shiftKey,
      });
      props.onRotate(patch);
    };
    listenUntilUp(onMove);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const delta = NUDGE_OFFSETS[e.key];

    if (delta) {
      e.preventDefault();
      const step = e.shiftKey ? STEP_FAST : STEP;
      props.onNudge(
        nudgeOverlay({
          position: value.position,
          scale: value.scale,
          natural: null,
          orientation,
          dx: delta[0] * step,
          dy: delta[1] * step,
        })
      );

      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      props.onDelete();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('animation.dragHint')}
      aria-pressed={active}
      onPointerDown={beginMove}
      onKeyDown={onKeyDown}
      style={boxStyle(rect, k, value.rotation, value.flip, value.opacity)}
      className={cn(
        'absolute cursor-move touch-none rounded-[2px] outline-none',
        active && 'ring-2 ring-brand-500 focus-visible:ring-2'
      )}
    >
      <AnimationMedia
        url={url}
        className="pointer-events-none absolute inset-0 h-full w-full object-fill select-none"
      />
      {active && (
        <MediaHandles
          resizeLabel={t('element.resize')}
          rotateLabel={t('element.rotate')}
          onResize={beginResize}
          onRotate={beginRotate}
        />
      )}
      <span className="sr-only">{kind}</span>
    </div>
  );
};

// 2% keyboard nudge directions; Partial so an unmapped key reads `undefined`.
const NUDGE_OFFSETS: Partial<Record<string, [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface HandlesProps {
  resizeLabel: string;
  rotateLabel: string;
  onResize: (e: ReactPointerEvent) => void;
  onRotate: (e: ReactPointerEvent) => void;
}

// Corner resize grip + top-centre rotate grip, on the unclipped box layer so they stay grabbable even
// when the overlay fills the frame. Mirrors AnimationFrameCanvas's grip markup.
const MediaHandles = ({ resizeLabel, rotateLabel, onResize, onRotate }: HandlesProps) => (
  <>
    <span
      role="button"
      tabIndex={-1}
      aria-label={resizeLabel}
      onPointerDown={onResize}
      className="absolute -right-1.5 -bottom-1.5 h-3.5 w-3.5 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-brand-500 shadow"
    />
    <span
      role="button"
      tabIndex={-1}
      aria-label={rotateLabel}
      onPointerDown={onRotate}
      className="absolute -top-5 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab touch-none rounded-full border-2 border-white bg-brand-500 shadow active:cursor-grabbing"
    />
  </>
);

// Window listeners (not pointer capture) so a drag keeps tracking once the cursor leaves the tiny box.
function listenUntilUp(onMove: (ev: PointerEvent) => void): void {
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// Position/size the box in display px, applying the overlay's rotation (around its centre), mirror
// flip and opacity. The flip fragment sits AFTER rotate so CSS (right-to-left) mirrors first, then
// rotates — matching the engine's flip-then-rotate leg chain.
function boxStyle(
  rect: { left: number; top: number; width: number; height: number },
  k: number,
  rotation: number | undefined,
  flip: OverlayFlip | undefined,
  opacity: number | undefined
): CSSProperties {
  const transform = [rotation ? `rotate(${rotation}deg)` : '', flipCssTransform(flip)].filter(Boolean).join(' ');

  return {
    left: rect.left * k,
    top: rect.top * k,
    width: rect.width * k,
    height: rect.height * k,
    transform: transform || undefined,
    opacity: opacity ?? 1,
  };
}
