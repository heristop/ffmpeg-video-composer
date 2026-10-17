import { useEffect, useRef, useState } from 'react';
import { Move } from '@/presentation/components/icons';
import { cn } from '@/lib/utils';
import type { VideoCrop } from '@/domain/valueObjects/videoEdits';

/** Displayed-video rect inside the editor container, in CSS pixels. */
export interface VideoRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const MIN_SIZE = 0.12; // smallest crop is 12% of the frame
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Compute a new normalized crop when dragging a corner by (dnx, dny) normalized deltas.
 * The opposite corner stays anchored; min size is enforced.
 */
function resizeByCorner(start: VideoCrop, corner: Corner, dnx: number, dny: number): VideoCrop {
  const right = start.x + start.w;
  const bottom = start.y + start.h;

  if (corner === 'tl') {
    const x = clamp(start.x + dnx, 0, right - MIN_SIZE);
    const y = clamp(start.y + dny, 0, bottom - MIN_SIZE);

    return { x, y, w: right - x, h: bottom - y };
  }

  if (corner === 'tr') {
    const y = clamp(start.y + dny, 0, bottom - MIN_SIZE);

    return { x: start.x, y, w: clamp(start.w + dnx, MIN_SIZE, 1 - start.x), h: bottom - y };
  }

  if (corner === 'bl') {
    const x = clamp(start.x + dnx, 0, right - MIN_SIZE);

    return { x, y: start.y, w: right - x, h: clamp(start.h + dny, MIN_SIZE, 1 - start.y) };
  }

  return {
    x: start.x,
    y: start.y,
    w: clamp(start.w + dnx, MIN_SIZE, 1 - start.x),
    h: clamp(start.h + dny, MIN_SIZE, 1 - start.y),
  };
}

/**
 * Draggable + resizable crop frame rendered over the displayed video. Reports the crop
 * normalized to the source frame (0..1) so it is resolution-independent.
 */
export function CropFrame({
  videoRect,
  crop,
  onChange,
}: {
  videoRect: VideoRect;
  crop: VideoCrop;
  onChange: (next: VideoCrop) => void;
}) {
  const cropRef = useRef<VideoCrop>(crop);
  const [dragging, setDragging] = useState<'move' | Corner | null>(null);

  useEffect(() => {
    cropRef.current = crop;
  }, [crop]);

  const startDrag = (kind: 'move' | Corner) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(kind);

    const startCrop = cropRef.current;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const dnx = (ev.clientX - startX) / videoRect.width;
      const dny = (ev.clientY - startY) / videoRect.height;

      if (kind === 'move') {
        onChange({
          ...startCrop,
          x: clamp(startCrop.x + dnx, 0, 1 - startCrop.w),
          y: clamp(startCrop.y + dny, 0, 1 - startCrop.h),
        });

        return;
      }

      onChange(resizeByCorner(startCrop, kind, dnx, dny));
    };

    const onUp = () => {
      setDragging(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Pixel rect of the crop frame within the container.
  const rect = {
    left: videoRect.left + crop.x * videoRect.width,
    top: videoRect.top + crop.y * videoRect.height,
    width: crop.w * videoRect.width,
    height: crop.h * videoRect.height,
  };

  const cornerPos = (corner: Corner) => ({
    left: corner === 'tl' || corner === 'bl' ? rect.left : rect.left + rect.width,
    top: corner === 'tl' || corner === 'tr' ? rect.top : rect.top + rect.height,
  });

  const isDragging = dragging !== null;
  const guide = cn('absolute bg-white/30 transition-opacity duration-200', isDragging ? 'opacity-90' : 'opacity-40');

  return (
    <div className="absolute inset-0 touch-none">
      {/* Dim + blurred mask around the crop region (four bands), keeping focus on the selection. */}
      <div
        className="absolute bg-black/55 backdrop-blur-[2px]"
        style={{ left: videoRect.left, top: videoRect.top, width: videoRect.width, height: rect.top - videoRect.top }}
      />
      <div
        className="absolute bg-black/55 backdrop-blur-[2px]"
        style={{
          left: videoRect.left,
          top: rect.top + rect.height,
          width: videoRect.width,
          height: videoRect.top + videoRect.height - (rect.top + rect.height),
        }}
      />
      <div
        className="absolute bg-black/55 backdrop-blur-[2px]"
        style={{ left: videoRect.left, top: rect.top, width: rect.left - videoRect.left, height: rect.height }}
      />
      <div
        className="absolute bg-black/55 backdrop-blur-[2px]"
        style={{
          left: rect.left + rect.width,
          top: rect.top,
          width: videoRect.left + videoRect.width - (rect.left + rect.width),
          height: rect.height,
        }}
      />

      {/* Draggable crop frame body. */}
      <div
        onPointerDown={startDrag('move')}
        className={cn(
          'group absolute border-2 cursor-move',
          isDragging ? 'border-brand-300 shadow-[0_0_30px_-4px] shadow-brand-500/50' : 'border-white/90',
          dragging !== 'move' && !isDragging && 'transition-all duration-150'
        )}
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      >
        {/* rule-of-thirds guides (emphasized while dragging) */}
        <div className={cn(guide, 'inset-y-0 w-px')} style={{ left: '33.33%' }} />
        <div className={cn(guide, 'inset-y-0 w-px')} style={{ left: '66.66%' }} />
        <div className={cn(guide, 'inset-x-0 h-px')} style={{ top: '33.33%' }} />
        <div className={cn(guide, 'inset-x-0 h-px')} style={{ top: '66.66%' }} />

        {/* move affordance — appears on hover */}
        <Move className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-white/80 drop-shadow opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

        {/* live dimension badge */}
        <span
          className={cn(
            'pointer-events-none absolute left-1/2 -translate-x-1/2 -top-7 px-2 py-0.5 rounded-md bg-black/75 text-white text-xs font-semibold tabular-nums whitespace-nowrap transition-all duration-150',
            isDragging ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
          )}
        >
          {Math.round(crop.w * 100)}% × {Math.round(crop.h * 100)}%
        </span>
      </div>

      {/* corner handles */}
      {CORNERS.map((corner) => {
        const pos = cornerPos(corner);
        const cursor = corner === 'tl' || corner === 'br' ? 'cursor-nwse-resize' : 'cursor-nesw-resize';

        return (
          <div
            key={corner}
            onPointerDown={startDrag(corner)}
            className={cn(
              'absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-white border-2 border-brand-500 shadow-lg shadow-brand-500/40 touch-none transition-transform duration-150 ease-[var(--ease-spring)] hover:scale-125 active:scale-110',
              dragging === corner && 'scale-125 ring-2 ring-brand-400/60',
              cursor
            )}
            style={{ left: pos.left, top: pos.top }}
          />
        );
      })}
    </div>
  );
}

export default CropFrame;
