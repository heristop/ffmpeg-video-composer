import { useId, useRef } from 'react';
import { cn } from '@/lib/utils';
import { REST_ANGLE, clapParts, feet, type ClappyMood, type ClappyPose, type ClickClapFrame } from './clappy.logic';
import { mayFollow } from './clappy-gaze.logic';
import { GAZE_VAR, useClappyGaze, type GazePose } from './use-clappy-gaze';
import { useClickClap, type ClickClap } from './use-click-clap';

// Clappy, the LeClap mascot: the logo mark (public/favicon.svg) redrawn by hand and gently chubby, then given
// a face, arms and little feet. It is the films' character (the private leclap-brand-motion repo:
// src/film/clappy.tsx) drawn the same way, so the app and the films show one Clappy: its design is fixed, only
// the pose and the mood change. Three differences from the films: no line boil (their redrawn-frame wobble
// reads as a glitch at UI sizes), a brand-tinted shadow that sits on light and dark pages alike, and a frame
// that holds the whole character, clapper open. Always decorative: the text beside it says what it means.

import {
  OUTLINE,
  PUPIL,
  BOARD_TOP,
  BOARD_BOTTOM,
  STRIPE_YELLOW,
  STRIPE_PERI,
  DOT,
  CHEEK,
  HINGE,
  BOARD,
  VIEW,
  ARM,
} from '@leclap/creative-kit/clappy';

// The row the eyes sit on; the face is drawn around it.
const EYES_Y = 396;

/** Where Clappy looks from, as a fraction of his frame: between his eyes. */
const GAZE_FROM = { x: (300 - VIEW.x) / VIEW.width, y: (EYES_Y - VIEW.y) / VIEW.height };

/** Clappy's height for a given width, in px. */
export const clappyHeight = (width: number): number => (width * VIEW.height) / VIEW.width;

export interface ClappyProps extends ClappyPose {
  /** Width in px; the height follows the frame (clappyHeight). */
  size: number;
  /** The soft shadow that lifts it off the page. */
  shadow?: boolean;
  /**
   * His eyes, and a little of his face, turn toward the visitor's pointer, then drift back to the pose's own
   * look once it rests or leaves (use-clappy-gaze.ts). Only where a pointer can hover, never under reduced
   * motion, and never while dozing or running; on by default. The wrappers keep it off while an act owns his look.
   */
  followPointer?: boolean;
  /**
   * A click or a tap on his drawing, not the box around it, makes him clap over whatever pose he's in, with the
   * clack when the site's sound is on (use-click-clap.ts). An easter egg: he stays hidden from assistive tech and
   * out of the tab order. On by default; off inside an overlay that lets clicks through, or his drawing takes them.
   */
  clapOnClick?: boolean;
  className?: string;
}

// His feet, where the press and the slam's squash pivot, as in the wrappers (50% 92% of the frame).
const FEET = { x: 300, y: VIEW.y + VIEW.height * 0.92 };

// The hint that he can be clicked: the hand cursor, and a small dip while pressed. Only his painted drawing
// takes the click (the svg itself lets clicks through), and a tap shows no highlight box.
const PRESSABLE =
  'pointer-events-auto cursor-pointer transition-transform duration-150 ease-out motion-safe:active:scale-[0.96] [-webkit-tap-highlight-color:transparent]';
const PRESS_ORIGIN = { transformOrigin: `${FEET.x}px ${FEET.y}px` };

/** His drawing's press: the clap and its hint when a click claps him, else nothing, so clicks pass through. */
const pressOf = (clap: ClickClap | null) =>
  clap === null ? {} : { className: PRESSABLE, onClick: clap.onClick, onPointerDown: clap.onPointerDown };

/** The pose with a click's clap laid over it: the clap takes the stick, the arms and, for a beat, the mood. */
const clappedOver = (pose: ClappyPose, frame: ClickClapFrame | null): ClappyPose => {
  if (frame === null) return pose;

  const { angle, armL, armR, grin } = frame;

  return { ...pose, angle, armL, armR, mood: grin ? 'grin' : pose.mood };
};

/** The slam's squash onto his feet, as an SVG transform; none without an impact. */
const squashOn = (frame: ClickClapFrame | null): string | undefined => {
  if (frame === null || frame.impact === 0) return undefined;

  const squash = frame.impact * 0.1;

  return `translate(${FEET.x} ${FEET.y}) scale(${1 + squash} ${1 - squash}) translate(${-FEET.x} ${-FEET.y})`;
};

/** What the follower needs of the pose: its look, and whether his eyes may leave it (clappy-gaze.logic.ts). */
const gazeOf = (pose: ClappyPose, follow: boolean): GazePose => ({
  lookX: pose.lookX ?? 0,
  lookY: pose.lookY ?? 0,
  follow: follow && mayFollow(pose),
});

export const Clappy = ({
  size,
  shadow = true,
  followPointer = true,
  clapOnClick = true,
  className,
  ...pose
}: ClappyProps) => {
  const id = `clappy${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const svg = useRef<SVGSVGElement>(null);
  const clap = useClickClap(clapParts(pose));

  useClappyGaze(svg, GAZE_FROM, gazeOf(pose, followPointer));

  return (
    <svg
      ref={svg}
      aria-hidden="true"
      width={size}
      height={clappyHeight(size)}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}
      className={cn('pointer-events-none select-none overflow-visible', className)}
    >
      <Defs id={id} />
      <g filter={shadow ? `url(#${id}-shadow)` : undefined}>
        <g style={PRESS_ORIGIN} {...pressOf(clapOnClick ? clap : null)}>
          <g transform={squashOn(clap.frame)}>
            <Character id={id} {...clappedOver(pose, clap.frame)} />
          </g>
        </g>
      </g>
    </svg>
  );
};

const Defs = ({ id }: { id: string }) => (
  <defs>
    <filter id={`${id}-shadow`} x="-40%" y="-40%" width="180%" height="190%">
      <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor={OUTLINE} floodOpacity="0.3" />
    </filter>
    <filter id={`${id}-grain`}>
      <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="3" seed="3" />
      <feColorMatrix values="0 0 0 0 0.37  0 0 0 0 0.32  0 0 0 0 0.67  0 0 0 0.5 0" />
    </filter>
    <linearGradient id={`${id}-board`} x1="0" y1="0" x2="0" y2="1">
      <stop stopColor={BOARD_TOP} />
      <stop offset="1" stopColor={BOARD_BOTTOM} />
    </linearGradient>
    <clipPath id={`${id}-clip`}>
      <path d={BOARD} />
    </clipPath>
    <pattern id={`${id}-stripes`} width="96" height="96" patternUnits="userSpaceOnUse" patternTransform="rotate(-26)">
      <rect width="96" height="96" fill={STRIPE_YELLOW} />
      <rect x="48" width="48" height="96" fill={STRIPE_PERI} />
    </pattern>
  </defs>
);

/** The posed character: limbs behind, then the logo's board, sticks and hinge block, then the face. */
const Character = ({
  id,
  angle = REST_ANGLE,
  lookX = 0,
  lookY = 0,
  blink = 0,
  mood = 'smile',
  armL = 50,
  armR = 50,
  stride,
}: ClappyPose & { id: string }) => (
  <>
    <Limbs id={id} armL={armL} armR={armR} stride={stride} />

    {/* the board: gradient fill a touch off-register, crayon grain, hatched shade, then the ink */}
    <path d={BOARD} fill={`url(#${id}-board)`} transform="translate(6 5)" />
    <g clipPath={`url(#${id}-clip)`}>
      <rect
        x="80"
        y="290"
        width="440"
        height="232"
        filter={`url(#${id}-grain)`}
        opacity="0.3"
        style={{ mixBlendMode: 'multiply' }}
      />
      {[0, 1, 2, 3, 4].map((index) => (
        <path
          key={index}
          d={`M${436 + index * 13} ${494 - index * 6} L${456 + index * 13} ${466 - index * 6}`}
          stroke={OUTLINE}
          strokeWidth={4}
          strokeLinecap="round"
          opacity={0.32}
        />
      ))}
    </g>
    <path d={BOARD} fill="none" stroke={OUTLINE} strokeWidth={22} strokeLinejoin="round" />

    {/* the sticks and the hinge block, as in the logo */}
    <Stick id={id} y={252} />
    <g transform={`rotate(${angle} ${HINGE})`}>
      <Stick id={id} y={192} />
    </g>
    <rect x="95" y="221" width="80" height="96" rx="24" fill={`url(#${id}-board)`} />
    <rect
      x="90"
      y="216"
      width="80"
      height="96"
      rx="24"
      fill="none"
      stroke={OUTLINE}
      strokeWidth={22}
      strokeLinejoin="round"
    />
    <circle cx="130" cy="264" r="17" fill={DOT} stroke={OUTLINE} strokeWidth={7} />

    <Face lookX={lookX} lookY={lookY} eye={Math.max(0.1, 1 - blink)} mood={mood} />
  </>
);

/** One clapper stick: striped fill off-register, then the ink. */
const Stick = ({ id, y }: { id: string; y: number }) => (
  <>
    <rect x="137" y={y + 5} width="372" height="58" rx="18" fill={`url(#${id}-stripes)`} />
    <rect
      x="132"
      y={y}
      width="372"
      height="58"
      rx="18"
      fill="none"
      stroke={OUTLINE}
      strokeWidth={22}
      strokeLinejoin="round"
    />
  </>
);

// Shoulders sit just inside the board's sides, a little above its middle.
const SHOULDER_Y = 344;

// A chubby arm hanging from its shoulder at the origin: slim where it joins the board, swelling into a
// round mitten at the end, so a raised arm reads as a hand rather than an ear.

/**
 * Chubby arms and two little feet, drawn behind the board. Each arm hangs from its shoulder pivot and swings
 * outward from there, so it stays attached however far it swings, and a raised arm clears the board's corner.
 * With a `stride`, the feet run (clappy.logic.ts: feet).
 */
const Limbs = ({ id, armL, armR, stride }: { id: string; armL: number; armR: number; stride?: number }) => {
  const [left, right] = feet(stride);

  return (
    <>
      <Blob cx={222 + left.dx} cy={524 + left.dy} rx={44} ry={22} fill={BOARD_BOTTOM} />
      <Blob cx={378 + right.dx} cy={524 + right.dy} rx={44} ry={22} fill={BOARD_BOTTOM} />
      <Arm id={id} x={98} angle={armL} />
      <Arm id={id} x={502} angle={-armR} />
    </>
  );
};

const Arm = ({ id, x, angle }: { id: string; x: number; angle: number }) => (
  <g transform={`translate(${x} ${SHOULDER_Y}) rotate(${angle})`}>
    <path d={ARM} fill={`url(#${id}-board)`} transform="translate(4 4)" />
    <path d={ARM} fill="none" stroke={OUTLINE} strokeWidth={13} strokeLinejoin="round" />
  </g>
);

/** A hand-inked blob: off-register fill, then the ink line. */
const Blob = ({ cx, cy, rx, ry, fill }: { cx: number; cy: number; rx: number; ry: number; fill: string }) => (
  <>
    <ellipse cx={cx + 4} cy={cy + 4} rx={rx} ry={ry} fill={fill} />
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={OUTLINE} strokeWidth={13} />
  </>
);

type EyeShape = 'open' | 'shut' | 'happy' | 'heart';

/** Each eye's shape for a mood (left, right). */
const eyeShapes = (mood: ClappyMood): readonly [EyeShape, EyeShape] => {
  if (mood === 'love') return ['heart', 'heart'];

  if (mood === 'sleepy') return ['shut', 'shut'];

  if (mood === 'proud') return ['happy', 'happy'];

  if (mood === 'wink') return ['open', 'shut'];

  return ['open', 'open'];
};

// How far a look carries the face (a small head-turn) and the pupils within their eyes, in the mark's units per
// look unit. The follower's share moves them just as far, so a look it takes over or hands back never jumps.
const FACE_TURN = { x: 10, y: 6 };
const PUPIL_TRAVEL = { x: 10, y: 11 };

/**
 * A translate by the follower's share of the look, read off the CSS properties it sets on the svg
 * (use-clappy-gaze.ts: GAZE_VAR), so the face and the pupils follow the pointer without a render. Unset, it is
 * nothing: a prerender, a touchscreen and reduced motion all draw the pose alone.
 */
const followed = (x: string, y: string, travel: { x: number; y: number }) => ({
  transform: `translate(calc(var(${x}, 0) * ${travel.x}px), calc(var(${y}, 0) * ${travel.y}px))`,
});

const FACE_FOLLOW = followed(GAZE_VAR.faceX, GAZE_VAR.faceY, FACE_TURN);
const PUPILS_FOLLOW = followed(GAZE_VAR.eyesX, GAZE_VAR.eyesY, PUPIL_TRAVEL);

const Face = ({ lookX, lookY, eye, mood }: { lookX: number; lookY: number; eye: number; mood: ClappyMood }) => {
  const [left, right] = eyeShapes(mood);
  // Focused narrows the eyes; a blink squashes them shut either way.
  const open = mood === 'focused' ? eye * 0.82 : eye;

  return (
    <g transform={`translate(${lookX * FACE_TURN.x} ${lookY * FACE_TURN.y})`}>
      <g style={FACE_FOLLOW}>
        <Eye cx={240} cy={EYES_Y} shape={left} open={open} lookX={lookX} lookY={lookY} />
        <Eye cx={360} cy={EYES_Y} shape={right} open={open} lookX={lookX} lookY={lookY} />
        <Blush cx={186} cy={444} />
        <Blush cx={414} cy={444} />
        <Mouth mood={mood} />
      </g>
    </g>
  );
};

const Eye = ({
  cx,
  cy,
  shape,
  open,
  lookX,
  lookY,
}: {
  cx: number;
  cy: number;
  shape: EyeShape;
  open: number;
  lookX: number;
  lookY: number;
}) => {
  if (shape === 'heart') {
    return (
      <path
        d={`M${cx} ${cy + 24} C${cx - 40} ${cy - 2} ${cx - 24} ${cy - 36} ${cx} ${cy - 14} C${cx + 24} ${cy - 36} ${cx + 40} ${cy - 2} ${cx} ${cy + 24} Z`}
        fill={CHEEK}
        stroke={OUTLINE}
        strokeWidth={9}
        strokeLinejoin="round"
      />
    );
  }

  if (shape === 'happy') {
    return (
      <path
        d={`M${cx - 26} ${cy + 10} Q${cx} ${cy - 18} ${cx + 26} ${cy + 10}`}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={10}
        strokeLinecap="round"
      />
    );
  }

  if (shape === 'shut' || open < 0.2) {
    return (
      <path
        d={`M${cx - 26} ${cy + 2} Q${cx} ${cy + 20} ${cx + 26} ${cy + 2}`}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={10}
        strokeLinecap="round"
      />
    );
  }

  // Where the pose's look has carried the pupil; the follower's share moves it on from there.
  const px = lookX * PUPIL_TRAVEL.x;
  const py = lookY * PUPIL_TRAVEL.y;

  return (
    <g transform={`translate(${cx} ${cy}) scale(1 ${open})`}>
      <ellipse rx={33} ry={38} fill="#fff" stroke={OUTLINE} strokeWidth={9} />
      <g style={PUPILS_FOLLOW}>
        <ellipse cx={px} cy={py + 3} rx={22} ry={25} fill={PUPIL} />
        <circle cx={px + 9} cy={py - 8} r={9} fill="#fff" />
        <circle cx={px - 8} cy={py + 13} r={4.5} fill="#fff" />
      </g>
    </g>
  );
};

/** A crayon blush with three little hatch marks. */
const Blush = ({ cx, cy }: { cx: number; cy: number }) => (
  <g>
    <ellipse cx={cx} cy={cy} rx={27} ry={14} fill={CHEEK} opacity={0.6} />
    {[-11, 0, 11].map((dx) => (
      <path
        key={dx}
        d={`M${cx + dx - 4} ${cy + 7} L${cx + dx + 5} ${cy - 7}`}
        stroke={OUTLINE}
        strokeWidth={3.6}
        strokeLinecap="round"
        opacity={0.5}
      />
    ))}
  </g>
);

const Mouth = ({ mood }: { mood: ClappyMood }) => {
  if (mood === 'wow') return <ellipse cx={300} cy={452} rx={16} ry={19} fill={PUPIL} />;

  if (mood === 'focused') {
    return <path d="M286 452 L314 452" fill="none" stroke={OUTLINE} strokeWidth={9} strokeLinecap="round" />;
  }

  if (mood === 'sleepy') {
    return <path d="M286 452 Q300 461 314 452" fill="none" stroke={OUTLINE} strokeWidth={9} strokeLinecap="round" />;
  }

  if (mood === 'grin' || mood === 'wink' || mood === 'love') {
    return (
      <g>
        <path d="M274 440 Q300 480 326 440 Z" fill={PUPIL} stroke={OUTLINE} strokeWidth={7} strokeLinejoin="round" />
        <path d="M287 458 Q300 471 313 458 Q300 463 287 458 Z" fill={CHEEK} />
      </g>
    );
  }

  return (
    <path
      d="M278 442 Q289 458 300 445 Q311 458 322 442"
      fill="none"
      stroke={OUTLINE}
      strokeWidth={9}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
};
