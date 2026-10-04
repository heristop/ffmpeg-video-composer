import { FitBox } from './FitBox';
import { AbsoluteFill, Img, interpolate, staticFile } from 'remotion';
import type { ReactNode } from 'react';
import type { WebAppPromoProps } from './WebAppPromo';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export type SceneState = {
  p: WebAppPromoProps & { mascot?: ReactNode };
  frame: number;
  hero: number;
  showcase: number;
  close: number;
  heroOpacity: number;
  showcaseOpacity: number;
  travel: number;
  muted: string;
  enter: (at: number) => number;
};
export function HeroScene(state: SceneState) {
  const { p, hero, heroOpacity, muted } = state;

  return (
    <AbsoluteFill
      style={{
        opacity: heroOpacity,
        top: 132,
        left: 100,
        width: 1080,
        height: 480,
        transform: `translateY(${36 * (1 - hero)}px)`,
      }}
    >
      <div style={{ position: 'absolute', right: 0, top: 0 }}>{p.mascot}</div>
      <FitBox width={1080} height={480}>
        <div style={{ color: p.accent, fontSize: 22, letterSpacing: 4, marginBottom: 26 }}>{p.eyebrow}</div>
        <div
          style={{
            fontSize: p.headline.length > 40 ? 76 : 96,
            lineHeight: 1.05,
            maxWidth: 900,
            fontWeight: 700,
            overflowWrap: 'anywhere',
          }}
        >
          {p.headline}
        </div>
        <div
          style={{
            fontSize: 28,
            lineHeight: 1.4,
            maxWidth: 760,
            marginTop: 30,
            color: muted,
            overflowWrap: 'anywhere',
          }}
        >
          {p.subheadline}
        </div>
        <div
          style={{
            marginTop: 36,
            width: 110,
            height: 4,
            backgroundColor: p.accent,
            transform: `scaleX(${hero})`,
            transformOrigin: 'left',
          }}
        />
      </FitBox>
    </AbsoluteFill>
  );
}

function BrowserView(state: SceneState) {
  const { p, frame, showcase, travel, muted } = state;

  return (
    <div style={{ position: 'absolute', left: 90, right: 90, top: 158, perspective: 1600 }}>
      <div
        style={{
          border: `1px solid ${p.accent}66`,
          borderRadius: 12,
          overflow: 'hidden',
          backgroundColor: p.backgroundColor,
          boxShadow: '0 32px 70px #0007',
          transform: `translateY(${55 * (1 - showcase)}px) scale(${0.92 + 0.08 * showcase + (p.cameraZoom - 1) * travel}) rotateY(${p.cameraTiltDegrees * (1 - 2 * travel)}deg) rotateX(${p.cameraTiltDegrees * 0.35}deg)`,
        }}
      >
        <div
          style={{
            height: 36,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '0 18px',
            borderBottom: `1px solid ${p.accent}33`,
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: p.accent, opacity: 0.5 }}
            />
          ))}
          <span style={{ marginLeft: 20, fontSize: 14, color: muted }}>{p.displayUrl}</span>
        </div>
        <div style={{ height: 346, position: 'relative', overflow: 'hidden' }}>
          <Img src={staticFile(p.screenshot)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div
            style={{
              position: 'absolute',
              left: '58%',
              top: '28%',
              width: '30%',
              height: '44%',
              border: `2px solid ${p.accent}`,
              borderRadius: 10,
              opacity: interpolate(frame, [p.showcaseStartFrame + 18, p.showcaseStartFrame + 36], [0, 1], clamp),
              boxShadow: `0 0 0 1000px ${p.backgroundColor}22`,
            }}
          />
          <svg
            width="30"
            height="38"
            viewBox="0 0 30 38"
            style={{
              position: 'absolute',
              left: `${35 + travel * 40}%`,
              top: `${65 - travel * 22}%`,
              filter: 'drop-shadow(0 2px 3px #0008)',
            }}
          >
            <path
              d="M2 2 L2 30 L10 23 L16 36 L22 33 L16 21 L28 21 Z"
              fill={p.textColor}
              stroke={p.backgroundColor}
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

export function ShowcaseScene(state: SceneState) {
  const { p, showcaseOpacity, enter } = state;

  return (
    <AbsoluteFill style={{ opacity: showcaseOpacity }}>
      <div style={{ position: 'absolute', top: 100, left: 64 }}>
        <FitBox width={1152} height={40}>
          <span style={{ fontSize: 22, letterSpacing: 3, color: p.accent, whiteSpace: 'nowrap' }}>{p.eyebrow}</span>
        </FitBox>
      </div>
      <BrowserView {...state} />
      <div style={{ position: 'absolute', left: 82, right: 82, bottom: 72, display: 'flex', gap: 20 }}>
        {p.features.map((feature, i) => {
          const progress = enter(p.showcaseStartFrame + 18 + i * 10);

          return (
            <div
              key={i}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '18px 20px',
                borderTop: `2px solid ${p.accent}`,
                backgroundColor: `${p.accent}10`,
                opacity: Math.min(1, Math.max(0, progress)),
                transform: `translateY(${30 * (1 - progress)}px)`,
              }}
            >
              <span style={{ color: p.accent, fontSize: 14 }}>0{i + 1} / </span>
              <span style={{ fontSize: 22, overflowWrap: 'anywhere' }}>{feature}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function ClosingScene(state: SceneState) {
  const { p, close, muted } = state;

  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(1, Math.max(0, close)),
        top: 128,
        left: 100,
        width: 1080,
        height: 500,
        transform: `translateY(${30 * (1 - close)}px)`,
      }}
    >
      <FitBox width={1080} height={500} center>
        <Img src={staticFile(p.logo)} style={{ width: 98, height: 98, objectFit: 'contain', marginBottom: 24 }} />
        <div
          style={{
            color: p.accent,
            fontSize: p.brand.length > 16 ? 64 : 96,
            lineHeight: 1.1,
            maxWidth: 1080,
            overflowWrap: 'anywhere',
            textAlign: 'center',
            fontWeight: 700,
          }}
        >
          {p.brand}
        </div>
        <div style={{ marginTop: 24, fontSize: 26, maxWidth: 940, textAlign: 'center', overflowWrap: 'anywhere' }}>
          {p.subheadline}
        </div>
        <div
          style={{
            marginTop: 32,
            padding: '16px 36px',
            backgroundColor: p.accent,
            color: p.backgroundColor,
            fontSize: 28,
            borderRadius: 6,
          }}
        >
          {p.cta} <span style={{ marginLeft: 16 }}>↗</span>
        </div>
        <div style={{ marginTop: 22, fontSize: 20, color: muted, maxWidth: 1080, overflowWrap: 'anywhere' }}>
          {p.displayUrl}
        </div>
      </FitBox>
    </AbsoluteFill>
  );
}
