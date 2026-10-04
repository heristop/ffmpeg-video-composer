import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Clappy } from './brand-motion-kit/film/clappy';
import { Grain, Vignette, Sparks, Shockwave } from './brand-motion-kit/film/cinema';
import { WebAppPromo, type WebAppPromoProps } from './WebAppPromo';

/** Selected original film effects, adapted to the registered ten-second JSON timeline. */
export function BrandMotionPromo(props: WebAppPromoProps) {
  const frame = useCurrentFrame();
  const open = interpolate(frame, [5, props.entranceDurationFrames, props.showcaseStartFrame - 10], [-25, -45, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <WebAppPromo
      {...props}
      atmosphere={
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <Sparks
            at={props.showcaseStartFrame}
            x={0.85}
            y={0.22}
            count={22}
            spread={250}
            seed="leclap-promo-showcase"
          />
          <Shockwave at={props.ctaStartFrame} x={0.5} y={0.35} color={props.accent} />
          <Grain opacity={0.06} />
          <Vignette strength={0.35} />
        </AbsoluteFill>
      }
      mascot={
        <div style={{ transform: `rotate(${Math.sin(frame / 18) * 4}deg)` }}>
          <Clappy size={140} mood="proud" angle={open} armL={35} armR={70} />
        </div>
      }
    />
  );
}
