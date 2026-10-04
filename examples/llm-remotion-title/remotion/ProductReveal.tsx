import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export type ProductRevealProps = {
  headline: string;
  accent: 'lavender' | 'mint' | 'coral';
  entranceDurationFrames: number;
};
export const productRevealDefaults: ProductRevealProps = {
  headline: 'Make something memorable',
  accent: 'lavender',
  entranceDurationFrames: 36,
};
const accents = { lavender: '#c4b5fd', mint: '#99f6e4', coral: '#fda4af' };

/** Deterministic geometry and system typography; no external media or private source. */
export function ProductReveal({ headline, accent, entranceDurationFrames }: ProductRevealProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame, fps, durationInFrames: entranceDurationFrames, config: { damping: 18 } });
  const fade = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const orbit = interpolate(frame, [0, 299], [-12, 12]);
  const color = accents[accent];

  return (
    <AbsoluteFill style={{ backgroundColor: '#14131d', color: '#faf9ff', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ position: 'absolute', top: 64, left: 80, color, fontSize: 18, letterSpacing: 4 }}>
        PRODUCT / REVEAL
      </div>
      <div
        style={{
          position: 'absolute',
          right: 110,
          top: 160,
          width: 310,
          height: 370,
          borderRadius: 48,
          background: color,
          transform: `translateY(${(1 - progress) * 100}px) rotate(${orbit}deg)`,
          opacity: fade,
          boxShadow: '0 32px 90px #00000055',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <div
          style={{
            width: 150,
            height: 150,
            border: '18px solid #14131d',
            borderRadius: 34,
            transform: `rotate(${45 * progress}deg)`,
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 260,
          width: 650,
          fontWeight: 700,
          fontSize: headline.length > 40 ? 48 : 64,
          lineHeight: 1.12,
          overflowWrap: 'anywhere',
          opacity: fade,
          transform: `translateY(${(1 - progress) * 48}px)`,
        }}
      >
        {headline}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 72,
          left: 80,
          width: 200 * progress,
          height: 6,
          borderRadius: 3,
          background: color,
        }}
      />
    </AbsoluteFill>
  );
}
