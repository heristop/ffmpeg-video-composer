import { useEffect, useState } from 'react';
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type TitleProps = {
  headline: string;
  headlineY: number;
  logoDelayFrames: number;
  entranceDurationFrames: number;
  springDamping: number;
  background: string;
  logo: string;
  font: string;
};

/** Every animated value follows frame time; props are the JSON customization surface. */
export function Title({
  headline,
  headlineY,
  logoDelayFrames,
  entranceDurationFrames,
  springDamping,
  background,
  logo,
  font,
}: TitleProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontReady] = useState(() => delayRender('Load the exact title font'));
  useEffect(() => {
    const face = new FontFace('LeclapTitleFont', `url("${staticFile(font)}")`);
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        continueRender(fontReady);
      })
      .catch((error: unknown) => cancelRender(error instanceof Error ? error : new Error(String(error))));
  }, [font, fontReady]);

  const logoProgress = spring({
    frame: frame - logoDelayFrames,
    fps,
    durationInFrames: entranceDurationFrames,
    config: { damping: springDamping, stiffness: 140 },
  });
  const titleProgress = spring({
    frame: frame - 12,
    fps,
    durationInFrames: entranceDurationFrames,
    config: { damping: springDamping, stiffness: 140 },
  });
  const fade = interpolate(frame, [270, 299], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#101022' }}>
      <OffthreadVideo
        src={staticFile(background)}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <AbsoluteFill style={{ opacity: fade }}>
        <Img
          src={staticFile(logo)}
          style={{
            position: 'absolute',
            width: 112,
            height: 112,
            left: 584,
            top: 140,
            objectFit: 'contain',
            opacity: Math.max(0, Math.min(1, logoProgress)),
            transform: `translateY(${40 * (1 - logoProgress)}px) scale(${0.8 + 0.2 * logoProgress})`,
          }}
        />
        <div
          style={{ position: 'absolute', left: 80, right: 80, top: headlineY, overflow: 'hidden', textAlign: 'center' }}
        >
          <div
            style={{
              fontFamily: 'LeclapTitleFont',
              fontSize: 100,
              fontWeight: 700,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              color: '#ffffff',
              transform: `translateY(${120 * (1 - titleProgress)}%)`,
            }}
          >
            {headline}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
