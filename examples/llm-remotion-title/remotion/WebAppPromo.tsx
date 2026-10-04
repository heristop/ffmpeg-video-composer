import { HeroScene, ShowcaseScene, ClosingScene } from './PromoScenes';
import { FitBox } from './FitBox';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import {
  AbsoluteFill,
  Img,
  cancelRender,
  continueRender,
  delayRender,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type WebAppPromoProps = {
  brand: string;
  eyebrow: string;
  headline: string;
  subheadline: string;
  cta: string;
  displayUrl: string;
  features: string[];
  accent: string;
  backgroundColor: string;
  textColor: string;
  showcaseStartFrame: number;
  ctaStartFrame: number;
  entranceDurationFrames: number;
  springDamping: number;
  cameraZoom: number;
  cameraTiltDegrees: number;
  screenshot: string;
  logo: string;
  font: string;
};
export const promoDefaults: WebAppPromoProps = {
  brand: 'LeClap',
  eyebrow: 'FROM IDEA TO LAUNCH',
  headline: 'Your next big idea. In motion.',
  subheadline: 'Turn your product into a story worth watching.',
  cta: 'Start creating',
  displayUrl: 'leclap.dev',
  features: ['Design with intent', 'Move with precision', 'Ship something remarkable'],
  accent: '#B9A2FF',
  backgroundColor: '#111120',
  textColor: '#FFFFFF',
  showcaseStartFrame: 90,
  ctaStartFrame: 240,
  entranceDurationFrames: 24,
  springDamping: 20,
  cameraZoom: 1.06,
  cameraTiltDegrees: 8,
  screenshot: 'screenshot.png',
  logo: 'logo.png',
  font: 'font.ttf',
};
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
/** Layout is trusted source; the typed JSON controls determine copy, palette and choreography. */
export function WebAppPromo(props: WebAppPromoProps & { atmosphere?: ReactNode; mascot?: ReactNode }) {
  const p = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [loadedFont, setLoadedFont] = useState<string | null>(null);
  const [fontHandle] = useState(() => delayRender('Load exact promo font'));
  useEffect(() => {
    const face = new FontFace('LeclapPromoFont', `url("${staticFile(p.font)}")`);
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        setLoadedFont(p.font);
      })
      .catch((error: unknown) => cancelRender(error instanceof Error ? error : new Error(String(error))));
  }, [p.font, fontHandle]);
  useLayoutEffect(() => {
    if (loadedFont === p.font) continueRender(fontHandle);
  }, [loadedFont, p.font, fontHandle]);

  function enter(at: number) {
    return spring({
      frame: frame - at,
      fps,
      durationInFrames: p.entranceDurationFrames,
      config: { damping: p.springDamping, stiffness: 140 },
    });
  }
  const hero = enter(5);
  const showcase = enter(p.showcaseStartFrame);
  const close = enter(p.ctaStartFrame);
  const heroOpacity = 1 - interpolate(frame, [p.showcaseStartFrame - 12, p.showcaseStartFrame + 12], [0, 1], clamp);
  const showcaseOpacity =
    interpolate(frame, [p.showcaseStartFrame, p.showcaseStartFrame + 12], [0, 1], clamp) *
    (1 - interpolate(frame, [p.ctaStartFrame - 12, p.ctaStartFrame + 12], [0, 1], clamp));
  const travel = interpolate(frame, [p.showcaseStartFrame, p.ctaStartFrame], [0, 1], clamp);
  const muted = `${p.textColor}B3`;
  const state = { p, frame, hero, showcase, close, heroOpacity, showcaseOpacity, travel, muted, enter };

  if (loadedFont !== p.font) return null;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: p.backgroundColor,
        color: p.textColor,
        fontFamily: 'LeclapPromoFont',
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at ${30 + frame / 10}% 25%, ${p.accent}26, transparent 65%)` }}
      />
      <div
        style={{
          position: 'absolute',
          width: 850,
          height: 850,
          right: -380,
          top: -390,
          border: `1px solid ${p.accent}40`,
          borderRadius: '50%',
          transform: `rotate(${frame / 4}deg)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 120,
            left: 120,
            width: 12,
            height: 12,
            background: p.accent,
            borderRadius: '50%',
          }}
        />
      </div>
      {p.atmosphere}
      <div style={{ position: 'absolute', left: 58, top: 34 }}>
        <Img src={staticFile(p.logo)} style={{ width: 40, height: 40, objectFit: 'contain' }} />
      </div>
      <div style={{ position: 'absolute', left: 110, top: 34 }}>
        <FitBox width={400} height={40}>
          <span style={{ fontSize: 24, letterSpacing: 1, whiteSpace: 'nowrap' }}>{p.brand}</span>
        </FitBox>
      </div>
      <div style={{ position: 'absolute', right: 58, top: 34 }}>
        <FitBox width={620} height={40} center>
          <span style={{ fontSize: 18, color: muted, whiteSpace: 'nowrap' }}>{p.displayUrl}</span>
        </FitBox>
      </div>
      <HeroScene {...state} />
      <ShowcaseScene {...state} />
      <ClosingScene {...state} />
    </AbsoluteFill>
  );
}
