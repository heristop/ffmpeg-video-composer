import { useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';
import { formatClock, fraction, keySeekTarget, pointerTime } from './player.logic';
import { previewSize } from './timeline.logic';
import { useFramePreview } from './use-frame-preview';
import type { MediaState } from './use-media-state';

// The seek bar as a strip of film: the played part in the brand's lavender→pink gradient over a lavender-tinted
// track, the buffered part a paler tint, a hairline notch where each scene starts, and a row of sprocket
// perforations under it. Its thumb is the app's playhead (GradientMeter): an off-white dot ringed in rose. While the
// pointer is over it (or drags it) a frame from that moment floats above, framed like a monitor, with a brand pill
// reading the scene and the time. A real Radix slider: arrows step 5 s, Page Up/Down a tenth, Home/End the ends,
// and it speaks "1:23 of 6:12". Mini frames drop the perforations and the frame preview.

const PREVIEW_EDGE = 168;

interface Hover {
  x: number;
  time: number;
}

/** Which scene a share of the bar falls in, counting from 1. */
const sceneAt = (share: number, markers: readonly number[]): number =>
  markers.filter((marker) => marker <= share).length + 1;

function SceneNotches({ markers }: { markers: readonly number[] }) {
  return (
    <>
      {markers.map((share) => (
        <span
          key={share}
          aria-hidden="true"
          className="absolute inset-y-0 z-[1] w-0.5 -translate-x-1/2 bg-player-ink/80"
          style={{ left: `${share * 100}%` }}
        />
      ))}
    </>
  );
}

function FramePreview({
  hover,
  width,
  media,
  markers,
  canvasRef,
}: {
  hover: Hover | null;
  width: number;
  media: MediaState;
  markers: readonly number[];
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const { t } = useTranslation('player');
  const size = previewSize(media.width, media.height, PREVIEW_EDGE);
  const half = size.width / 2;
  const x = hover ? Math.min(Math.max(hover.x, half), Math.max(half, width - half)) : 0;
  const share = hover ? fraction(hover.time, media.duration) : 0;

  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute bottom-7 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5 transition-[opacity,transform] duration-150 ease-[var(--ease-out-expo)]',
        hover && media.duration > 0 ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
      )}
      style={{ left: x }}
    >
      <span className="block overflow-hidden rounded-lg bg-player-ink shadow-[var(--shadow-glow)] ring-1 ring-brand-300/45 @max-[24rem]/player:hidden">
        <canvas ref={canvasRef} width={size.width} height={size.height} className="block" />
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-player-ink/90 px-2.5 py-1 font-mono text-[0.7rem] font-medium tabular-nums text-player-fg ring-1 ring-brand-400/50">
        {markers.length > 0 && (
          <span className="uppercase tracking-[0.12em] text-brand-200">
            {t('scene', { number: String(sceneAt(share, markers)).padStart(2, '0') })}
          </span>
        )}
        {hover ? formatClock(hover.time) : ''}
      </span>
    </span>
  );
}

export function PlayerTimeline({
  media,
  videoRef,
  markers = [],
  onSeek,
  onScrub,
  className,
}: {
  media: MediaState;
  /** The playing element: the frame preview reads its source. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Where scenes start, as shares of the bar (timeline.logic.ts). */
  markers?: readonly number[];
  onSeek: (seconds: number) => void;
  /** Whether a drag is under way, so the chrome stays up meanwhile. */
  onScrub?: (scrubbing: boolean) => void;
  className?: string;
}) {
  const { t } = useTranslation('player');
  const rootRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [width, setWidth] = useState(0);
  const preview = useFramePreview(videoRef);
  const { current, duration } = media;
  const now = formatClock(current);
  const total = formatClock(duration);

  return (
    <SliderPrimitive.Root
      ref={rootRef}
      value={[Math.min(current, duration)]}
      max={duration > 0 ? duration : 1}
      step={0.01}
      disabled={duration === 0}
      onValueChange={([next]) => {
        onSeek(next);
      }}
      onPointerDown={() => onScrub?.(true)}
      onValueCommit={() => onScrub?.(false)}
      onLostPointerCapture={() => onScrub?.(false)}
      onKeyDown={(event) => {
        const target = keySeekTarget(event.key, current, duration);

        if (target === null) return;

        event.preventDefault();
        onSeek(target);
      }}
      onPointerMove={(event) => {
        const box = rootRef.current?.getBoundingClientRect();

        if (!box || duration === 0) return;

        const time = pointerTime(event.clientX, box, duration);

        setWidth(box.width);
        setHover({ x: Math.min(box.width, Math.max(0, event.clientX - box.left)), time });
        preview.request(time);
      }}
      onPointerLeave={() => {
        setHover(null);
      }}
      className={cn(
        'group/seek relative flex h-7 w-full cursor-pointer touch-none select-none items-center data-[disabled]:cursor-default',
        className
      )}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full origin-center overflow-hidden rounded-full bg-brand-300/20 transition-transform duration-200 ease-[var(--ease-out-expo)] group-hover/seek:scale-y-[1.35] group-has-[:focus-visible]/seek:scale-y-[1.35]">
        <span
          aria-hidden="true"
          className="absolute inset-0 origin-left bg-brand-200/30"
          style={{ transform: `scaleX(${fraction(media.buffered, duration)})` }}
        />
        <SliderPrimitive.Range className="brand-gradient absolute h-full" />
        <SceneNotches markers={markers} />
      </SliderPrimitive.Track>
      <span
        aria-hidden="true"
        className="player-sprockets pointer-events-none absolute inset-x-0 bottom-0 h-1 opacity-50 transition-opacity duration-200 group-hover/seek:opacity-90 @max-[24rem]/player:hidden"
      />
      <SliderPrimitive.Thumb
        aria-label={t('seek')}
        aria-valuetext={t('position', { current: now, total })}
        className="block size-3.5 scale-75 rounded-full border-2 border-secondary-400 bg-player-fg shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-player-ink)_40%,transparent)] transition-transform duration-150 ease-[var(--ease-out-expo)] group-hover/seek:scale-110 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/60"
      />
      <FramePreview hover={hover} width={width} media={media} markers={markers} canvasRef={preview.canvasRef} />
    </SliderPrimitive.Root>
  );
}
