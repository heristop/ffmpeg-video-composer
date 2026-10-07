import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { colors } from '@/src/styles/theme';
import { DUST_RUNNER_PX, PUFF_MAX } from './clappy-working-motion';
import {
  ARM,
  BOARD,
  BOARD_BOTTOM,
  BOARD_TOP,
  CHEEK,
  DOT,
  OUTLINE,
  PUPIL,
  STRIPE_PERI,
  STRIPE_YELLOW,
  VIEW,
} from '@leclap/creative-kit/clappy';

// Clappy's drawing, cut into the parts that move independently. Every part is its own SVG layer in the
// same viewBox, so stacking them reproduces the single drawing exactly and each part animates as a
// composited view transform around its own joint (no per-frame SVG re-render).

export type ClappyState = 'welcome' | 'working' | 'success' | 'search' | 'error';

export const JOINTS = {
  hinge: [140, 250],
  leftShoulder: [98, 344],
  rightShoulder: [502, 344],
  eyes: [300, 396],
  // The web runner's transform origin (50% 92% of the frame): squash and lean pivot just above the soles.
  ground: [300, 517],
} as const;

const mouths: Record<ClappyState, string> = {
  welcome: 'M278 442 Q289 458 300 445 Q311 458 322 442',
  search: 'M278 442 Q289 458 300 445 Q311 458 322 442',
  error: 'M280 458 Q300 438 320 458',
  // The web's smile: he works happily (its flat 'focused' mouth and narrowed eyes read as annoyed).
  working: 'M278 442 Q289 458 300 445 Q311 458 322 442',
  success: '',
};

export const clappyHeight = (size: number) => (size * VIEW.height) / VIEW.width;

/** A full-frame box for a layer or a group of layers. */
export const layerFrame = (size: number) =>
  ({ position: 'absolute', left: 0, top: 0, width: size, height: clappyHeight(size) }) as const;

/** A joint in the drawing's space, as a transform origin in the rendered view's points. */
export function jointOrigin(size: number, [x, y]: readonly [number, number]): ViewStyle['transformOrigin'] {
  const k = size / VIEW.width;

  return [(x - VIEW.x) * k, (y - VIEW.y) * k, 0];
}

export function ClappyLayer({
  id,
  size,
  joint,
  style,
  children,
}: {
  id: string;
  size: number;
  joint?: readonly [number, number];
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  children: ReactNode;
}) {
  const height = clappyHeight(size);

  return (
    // Each layer is a still drawing that only moves: cache it as a texture so a transform never redraws the SVG
    // (redrawing a dozen full-canvas layers every frame starved Android's main thread).
    <Animated.View
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={[layerFrame(size), joint ? { transformOrigin: jointOrigin(size, joint) } : null, style]}
    >
      <Svg width={size} height={height} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`}>
        <Defs>
          <LinearGradient id={`${id}-board`} x1="0" y1="0" x2="0" y2="1">
            <Stop stopColor={BOARD_TOP} />
            <Stop offset="1" stopColor={BOARD_BOTTOM} />
          </LinearGradient>
          <Pattern
            id={`${id}-stripes`}
            width={96}
            height={96}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-26)"
          >
            <Rect width={96} height={96} fill={STRIPE_YELLOW} />
            <Rect x={48} width={48} height={96} fill={STRIPE_PERI} />
          </Pattern>
        </Defs>
        {children}
      </Svg>
    </Animated.View>
  );
}

function Stick({ id, y }: { id: string; y: number }) {
  return (
    <G>
      <Rect x={137} y={y + 5} width={372} height={58} rx={18} fill={`url(#${id}-stripes)`} />
      <Rect
        x={132}
        y={y}
        width={372}
        height={58}
        rx={18}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={22}
        strokeLinejoin="round"
      />
    </G>
  );
}

export function Arm({ id, side, state }: { id: string; side: 'left' | 'right'; state: ClappyState }) {
  const raised = state === 'success' || (side === 'left' && state === 'welcome');
  const angle = (raised ? 130 : 50) * (side === 'left' ? 1 : -1);
  const x = side === 'left' ? JOINTS.leftShoulder[0] : JOINTS.rightShoulder[0];

  return (
    <G transform={`translate(${x} 344) rotate(${angle})`}>
      <Path d={ARM} fill={`url(#${id}-board)`} transform="translate(4 4)" />
      <Path d={ARM} fill="none" stroke={OUTLINE} strokeWidth={13} strokeLinejoin="round" />
    </G>
  );
}

/** The moving top stick, resting at the logo's open angle. */
export function Clapper({ id }: { id: string }) {
  return (
    <G transform={`rotate(-25 ${JOINTS.hinge.join(' ')})`}>
      <Stick id={id} y={192} />
    </G>
  );
}

/** One foot, drawn behind the board; it steps by moving its own layer. */
export function Foot({ cx }: { cx: number }) {
  return (
    <G>
      <Ellipse cx={cx + 4} cy={528} rx={44} ry={22} fill={BOARD_BOTTOM} />
      <Ellipse cx={cx} cy={524} rx={44} ry={22} fill="none" stroke={OUTLINE} strokeWidth={13} />
    </G>
  );
}

/** The board and the fixed lower stick. */
export function Body({ id }: { id: string }) {
  return (
    <G>
      <Path d={BOARD} fill={`url(#${id}-board)`} transform="translate(6 5)" />
      <Path d={BOARD} fill="none" stroke={OUTLINE} strokeWidth={22} strokeLinejoin="round" />
      <Stick id={id} y={252} />
    </G>
  );
}

/** Hinge block and cheeks: everything on the front that stays put. */
export function Face({ id }: { id: string }) {
  return (
    <G>
      <Rect x={95} y={221} width={80} height={96} rx={24} fill={`url(#${id}-board)`} />
      <Rect x={90} y={216} width={80} height={96} rx={24} fill="none" stroke={OUTLINE} strokeWidth={22} />
      <Circle cx={130} cy={264} r={17} fill={DOT} stroke={OUTLINE} strokeWidth={7} />
      {[186, 414].map((cx) => (
        <Ellipse key={cx} cx={cx} cy={444} rx={27} ry={14} fill={CHEEK} opacity={0.6} />
      ))}
    </G>
  );
}

const Grin = () => (
  <G>
    <Path d="M274 440 Q300 480 326 440 Z" fill={PUPIL} stroke={OUTLINE} strokeWidth={7} />
    <Path d="M287 458 Q300 471 313 458 Q300 463 287 458 Z" fill={CHEEK} />
  </G>
);

const HappyEyes = () => (
  <G>
    {[240, 360].map((cx) => (
      <Path
        key={cx}
        d={`M${cx - 26} 406 Q${cx} 378 ${cx + 26} 406`}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={10}
        strokeLinecap="round"
      />
    ))}
  </G>
);

export function Mouth({ state }: { state: ClappyState }) {
  if (state === 'success') return <Grin />;

  return <Path d={mouths[state]} fill="none" stroke={OUTLINE} strokeWidth={9} strokeLinecap="round" />;
}

/** The web's grin mood (happy arcs and an open grin), faded in over the face for a cheer. */
export function Joy() {
  return (
    <G>
      <HappyEyes />
      <Grin />
    </G>
  );
}

export function Whites({ state }: { state: ClappyState }) {
  if (state === 'success') return <HappyEyes />;

  return (
    <G>
      {[240, 360].map((cx) => (
        <Ellipse key={cx} cx={cx} cy={396} rx={33} ry={38} fill={DOT} stroke={OUTLINE} strokeWidth={9} />
      ))}
    </G>
  );
}

/** Pupils and their glints, on their own layer so a look can move them inside the eyes. */
export function Pupils({ state }: { state: ClappyState }) {
  if (state === 'success') return null;
  const shift = state === 'search' ? 8 : 0;

  return (
    <G>
      {[240, 360].map((cx) => (
        <G key={cx} transform={`translate(${cx} 396)`}>
          <Ellipse cx={shift} cy={3} rx={22} ry={25} fill={PUPIL} />
          <Circle cx={9} cy={-8} r={9} fill={DOT} />
          <Circle cx={-8} cy={13} r={4.5} fill={DOT} />
        </G>
      ))}
    </G>
  );
}

/**
 * One dust puff behind the runner, anchored at the frame's bottom-left like the web's, drawn at its largest
 * and scaled from its bottom-left corner. The web softens it with a 1px blur; native draws it crisp.
 */
function DustPuff({ side, style }: { side: number; style: StyleProp<AnimatedStyle<ViewStyle>> }) {
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: side,
          height: side,
          borderRadius: side / 2,
          backgroundColor: colors.primaryLight,
          transformOrigin: [0, side, 0],
        },
        style,
      ]}
    />
  );
}

/** The run's dust, only while he works and motion is allowed: under reduced motion it isn't drawn at all. */
export function Dust({
  state,
  still,
  size,
  styles,
}: {
  state: ClappyState;
  still: boolean;
  size: number;
  styles: StyleProp<AnimatedStyle<ViewStyle>>[];
}) {
  if (state !== 'working' || still) return null;
  const side = (PUFF_MAX * size) / DUST_RUNNER_PX;

  return styles.map((style, index) => <DustPuff key={index} side={side} style={style} />);
}
