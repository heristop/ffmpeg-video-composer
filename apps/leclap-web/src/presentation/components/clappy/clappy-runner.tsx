import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useAnimationClock } from '@/hooks/use-animation-clock';
import { kineticMotion } from '@/presentation/components/kinetic';
import { Clappy, clappyHeight } from './clappy';
import { runnerFrame } from './clappy.logic';
import { railLeft } from './clappy-rail.logic';

export interface ClappyRunnerProps {
  /** How far along the track Clappy has run, 0..1: the progress of the bar under him. */
  progress: number;
  /** The run is over: Clappy stops at the finish line, arms up. */
  done?: boolean;
  /** Clappy's width in px. */
  size?: number;
  /** Past the finish line, his eyes follow the pointer (Clappy: followPointer). On by default. */
  followPointer?: boolean;
  /** A click makes him clap, mid-run too (Clappy: clapOnClick). On by default. */
  clapOnClick?: boolean;
  className?: string;
}

// The render loader, as the showcase film plays it: Clappy runs the lane above a progress bar, keeping pace
// with its fill — feet trading places, arms pumping, the clapper clacking on each step, dust puffing behind —
// and throws his arms up at the finish. He is the loader's one ambient mover, so he keeps running while a slow
// segment holds the bar still: that is what says the render is still going. His eyes stay on the track until
// the finish, where they're free to follow the pointer. Under reduced motion he stands at his place on the
// track instead. Decorative: the bar under him carries the progressbar role.
export function ClappyRunner({
  progress,
  done = false,
  size = 64,
  followPointer = true,
  clapOnClick = true,
  className,
}: ClappyRunnerProps) {
  const reduced = useReducedMotion() ?? false;
  const seconds = useAnimationClock(!done && !reduced);
  const { pose, bob, lean } = runnerFrame(seconds, { done, still: reduced });
  const squash = bob * 0.03;
  const laneRef = useRef<HTMLDivElement>(null);
  const laneWidth = useLaneWidth(laneRef);

  return (
    <div ref={laneRef} aria-hidden="true" className={cn('relative', className)} style={{ height: clappyHeight(size) }}>
      {/* He stands on the fill's leading edge (clappy-rail.logic.ts): his back half behind the line at the
          start, pulled up inside the lane at the finish. He moves on the meter's own transition, from the
          line as the fill grows from empty, so he keeps pace with the edge. Placed once the lane is measured. */}
      {laneWidth > 0 && (
        <motion.div
          className="absolute bottom-0 left-0"
          initial={{ x: railLeft(0, laneWidth, size) }}
          animate={{ x: railLeft(progress, laneWidth, size) }}
          transition={{ duration: reduced ? 0 : kineticMotion.duration.ring, ease: [0.16, 1, 0.3, 1] }}
        >
          {pose.stride !== undefined && <Dust size={size} stride={pose.stride} />}
          <div
            style={{
              transform: `translateY(${-bob * (size / 12)}px) rotate(${lean}deg) scale(${1 + squash}, ${1 - squash})`,
              transformOrigin: '50% 92%',
            }}
          >
            <Clappy size={size} {...pose} followPointer={followPointer && done} clapOnClick={clapOnClick} />
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** The lane's width in px, kept current as it resizes; 0 until it is laid out. */
function useLaneWidth(laneRef: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const lane = laneRef.current;

    if (!lane) return () => {};

    const measure = () => {
      setWidth(lane.clientWidth);
    };

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(lane);

    return () => {
      observer.disconnect();
    };
  }, [laneRef]);

  return width;
}

/** Three puffs kicked up behind the runner, each drifting back and fading over one stride. */
const Dust = ({ size, stride }: { size: number; stride: number }) => {
  // The film's puffs were sized for a 120 px runner.
  const scale = size / 120;

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
