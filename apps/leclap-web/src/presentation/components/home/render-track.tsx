import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { Clappy, clappyHeight } from '@/presentation/components/clappy';
import { RUN_CADENCE, runnerFrame } from '@/presentation/components/clappy/clappy.logic';
import { railLeft } from '@/presentation/components/clappy/clappy-rail.logic';
import { advanceStride, facingAfter, trackProgress } from './render-track.logic';

/** Clappy's width in px: a size up from the loader's runner, since here the run is the whole moment. */
const SIZE = 80;
/** Ground covered per stride, in px: about his own width, so his feet keep pace with the track under them. */
const STRIDE_PX = 88;
/** No scroll for this long and the page has stopped: he stands on the track until it moves again. */
const IDLE_MS = 160;

interface TrackFrame {
  /** How far the render has come, 0..1. */
  progress: number;
  /** Clappy's offset along the rail, and the lane's width, in px. */
  x: number;
  width: number;
  /** The run cycle, in turns. */
  stride: number;
  /** 1 facing the finish, -1 running back up the page. */
  facing: 1 | -1;
  idle: boolean;
}

const AT_THE_LINE: TrackFrame = { progress: 0, x: -SIZE / 2, width: 0, stride: 0, facing: 1, idle: true };

const sameFrame = (a: TrackFrame, b: TrackFrame): boolean =>
  a.progress === b.progress &&
  a.x === b.x &&
  a.width === b.width &&
  a.stride === b.stride &&
  a.facing === b.facing &&
  a.idle === b.idle;

// The bridge into the finished render: the render loader's own lane (ClappyRunner, ProgressDisplay), driven
// by the scroll instead of a compile, so scrolling is the render. As the track rises through the viewport
// (render-track.logic.ts) the lavender→pink bar fills and Clappy runs along it, his legs keeping pace with
// the ground he covers; the page stopping stands him still, and scrolling back up turns him round.
// He throws his arms up at the finish as the bar settles to success, just as the render itself comes up
// below. The page is read once a frame (one rect, while the track is near), and only the track re-renders.
// Under reduced motion nothing follows the scroll: the render is simply done, the bar full, Clappy arrived.
// Decorative: a transition between two sections, not a section of its own.
export const RenderTrack = () => {
  const reduced = useReducedMotion();
  const [nearRef, near] = useInView({ once: false, threshold: 0, rootMargin: '200px 0px' });
  const laneRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<TrackFrame>(AT_THE_LINE);

  useEffect(() => {
    if (reduced || !near) return () => {};

    let frameId = 0;
    let idleTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const paint = (idle: boolean) => {
      const lane = laneRef.current;

      if (!lane) return;

      const rect = lane.getBoundingClientRect();
      const progress = trackProgress(rect.top, globalThis.innerHeight);
      const x = railLeft(progress, rect.width, SIZE);
      const onTheTrack = progress > 0 && progress < 1;

      setFrame((previous) => {
        const dx = x - previous.x;
        const next: TrackFrame = {
          progress,
          x,
          width: rect.width,
          stride: advanceStride(previous.stride, dx, STRIDE_PX),
          // Off the track, at either end, he faces the finish.
          facing: onTheTrack ? facingAfter(previous.facing, dx) : 1,
          idle,
        };

        return sameFrame(previous, next) ? previous : next;
      });
    };

    const onScroll = () => {
      if (!frameId) {
        frameId = globalThis.requestAnimationFrame(() => {
          frameId = 0;
          paint(false);
        });
      }

      globalThis.clearTimeout(idleTimer);
      idleTimer = globalThis.setTimeout(() => {
        paint(true);
      }, IDLE_MS);
    };

    paint(true);
    globalThis.addEventListener('scroll', onScroll, { passive: true });
    globalThis.addEventListener('resize', onScroll, { passive: true });

    return () => {
      globalThis.removeEventListener('scroll', onScroll);
      globalThis.removeEventListener('resize', onScroll);
      globalThis.cancelAnimationFrame(frameId);
      globalThis.clearTimeout(idleTimer);
    };
  }, [reduced, near]);

  const progress = reduced ? 1 : frame.progress;
  const done = progress >= 1;
  // The stride comes from the ground covered, not the clock: runnerFrame reads it back as seconds of a run.
  const { pose, bob, lean } = runnerFrame(frame.stride / RUN_CADENCE, {
    done,
    still: frame.idle || progress <= 0,
  });
  const squash = bob * 0.03;

  return (
    <div ref={nearRef} aria-hidden="true" className="pointer-events-none relative bg-background py-6 sm:py-8">
      {/* The film frames' own column, so the track spans the width of the render it leads into. */}
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <div ref={laneRef} className="relative" style={{ height: clappyHeight(SIZE) }}>
            {/* He stands on the fill's leading edge, as in the loader (clappy-rail.logic.ts): his back half
                behind the line at the start, pulled up inside the lane at the finish. Under reduced motion he
                simply stands at the finish. */}
            <div
              className={cn('absolute bottom-0 will-change-transform', reduced ? 'right-0' : 'left-0')}
              style={{ width: SIZE, transform: reduced ? undefined : `translateX(${frame.x}px)` }}
            >
              <div style={{ transform: `scaleX(${frame.facing})` }}>
                {pose.stride !== undefined && <Dust stride={pose.stride} />}
                {/* The lean and the bob pivot from his feet, as in the loader. */}
                <div
                  style={{
                    transform: `translateY(${-bob * (SIZE / 12)}px) rotate(${lean}deg) scale(${1 + squash}, ${1 - squash})`,
                    transformOrigin: '50% 92%',
                  }}
                >
                  {/* His eyes follow the pointer only once he has arrived, as in the studio's loader: mid-run
                      they stay on the track. */}
                  <Clappy size={SIZE} followPointer={done} {...pose} />
                </div>
              </div>
            </div>
          </div>

          {/* The loader's bar: a groove, the gradient fill, a rounded leading edge, and the success swap at the
              finish. The fill scales and the cap slides (transform only); the swap fades in over the fill. */}
          <div className="relative h-3 overflow-hidden rounded-full bg-brand-500/15">
            <div className="brand-gradient absolute inset-0 origin-left" style={{ transform: `scaleX(${progress})` }} />
            {!reduced && progress > 0 && (
              <span
                className="absolute inset-y-0 left-0 w-3 rounded-full bg-secondary-400"
                style={{ transform: `translateX(calc(${progress * frame.width}px - 100%))` }}
              />
            )}
            <div
              className={cn(
                'absolute inset-0 bg-success transition-opacity duration-300',
                done ? 'opacity-100' : 'opacity-0'
              )}
            />
          </div>
          <p
            className={cn(
              'mt-2 text-right text-xs font-semibold tabular-nums tracking-[0.08em]',
              done ? 'text-success-foreground dark:text-success' : 'text-brand-700 dark:text-brand-300'
            )}
          >
            {Math.round(progress * 100)}%
          </p>
        </div>
      </div>
    </div>
  );
};

/** Three puffs kicked up behind him, each drifting back and fading over one stride (as in ClappyRunner). */
const Dust = ({ stride }: { stride: number }) => {
  // The film's puffs were sized for a 120 px runner.
  const scale = SIZE / 120;

  return (
    <>
      {[0, 1, 2].map((index) => {
        const age = (stride + index / 3) % 1;
        const puff = (10 + age * 16) * scale;

        return (
          <span
            key={index}
            className="absolute rounded-full bg-brand-300 blur-[1px]"
            style={{
              left: (18 - age * 46) * scale,
              bottom: (8 + age * 14) * scale,
              width: puff,
              height: puff,
              opacity: (1 - age) * 0.6,
            }}
          />
        );
      })}
    </>
  );
};
