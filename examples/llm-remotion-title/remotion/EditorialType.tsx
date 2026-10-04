import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import { editorialTiming, editorialWords, fitEditorialFontSize, type EditorialProps } from './editorial-timing';

export { editorialDefaults } from './editorial-timing';

const accents = { lavender: '#aaa0ff', mint: '#a0efcc', orange: '#ff9354' };
const safeWidth = 1088;

const copyStyle: CSSProperties = {
  width: safeWidth,
  fontWeight: 800,
  letterSpacing: -2,
  lineHeight: 1.12,
  overflowWrap: 'anywhere',
};

/** Shared resting geometry for the invisible measurement and the visible animated words. */
function EditorialWords({
  props,
  frame,
  durationInFrames = 300,
}: {
  props: EditorialProps;
  frame?: number;
  durationInFrames?: number;
}) {
  const words = editorialWords(props.headline);
  const highlighted = Math.min(props.highlightWord, words.length - 1);

  return words.map((word, index) => {
    const timing = frame === undefined ? undefined : editorialTiming(frame, index, props, durationInFrames);
    const marked = timing && props.mode === 'highlight' && index === highlighted;

    return (
      <span key={index}>
        <span
          style={{
            display: 'inline-block',
            maxWidth: '100%',
            boxSizing: 'border-box',
            verticalAlign: 'top',
            padding: '0.06em 0.025em',
            overflow: props.mode === 'masked-rise' || props.mode === 'split-slide' ? 'hidden' : undefined,
          }}
        >
          <span
            style={{
              display: 'block',
              position: 'relative',
              opacity: timing?.opacity,
              transform: timing
                ? `translate(${timing.translateX}px, ${timing.translateY}px) scale(${timing.scale})`
                : undefined,
              filter: timing?.blurPx ? `blur(${timing.blurPx}px)` : undefined,
              transformOrigin: 'left bottom',
            }}
          >
            {marked && (
              <span
                style={{
                  position: 'absolute',
                  inset: '0.13em -0.025em 0.06em',
                  backgroundColor: accents[props.accent],
                  opacity: 0.28,
                  clipPath: `inset(0 ${(1 - timing.highlightProgress) * 100}% 0 0)`,
                }}
              />
            )}
            <span style={{ position: 'relative' }}>{word}</span>
          </span>
        </span>
        {index < words.length - 1 ? ' ' : null}
      </span>
    );
  });
}

/** Opaque, asset-free editorial typography. Every animated style follows composition frame time. */
export function EditorialType(props: EditorialProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const accent = accents[props.accent];
  const scene = editorialTiming(frame, 0, props, durationInFrames);
  const measurement = useRef<HTMLDivElement>(null);
  const [captureHandle] = useState(() => delayRender('Fit static editorial copy'));
  const [fontSize, setFontSize] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = measurement.current;

    if (!node) return;

    try {
      setFontSize(
        fitEditorialFontSize((candidate) => {
          node.style.fontSize = `${candidate}px`;

          return node.scrollWidth <= safeWidth && node.scrollHeight <= 416;
        })
      );
    } catch (error) {
      cancelRender(error instanceof Error ? error : new Error(String(error)));
    }
  }, [props.headline, props.mode]);
  useLayoutEffect(() => {
    if (fontSize !== null) continueRender(captureHandle);
  }, [fontSize, captureHandle]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#10141e', color: '#f6f4ee', fontFamily: 'Arial, sans-serif' }}>
      <div
        ref={measurement}
        aria-hidden
        style={{
          ...copyStyle,
          position: 'absolute',
          left: 96,
          top: 198,
          visibility: 'hidden',
          fontSize: fontSize ?? 104,
        }}
      >
        <EditorialWords props={props} />
      </div>
      <AbsoluteFill style={{ opacity: scene.sceneOpacity }}>
        <div style={{ position: 'absolute', inset: 44, border: '1px solid #394151', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 80, top: 80, width: 42, height: 5, backgroundColor: accent }} />
        {props.kicker && (
          <div
            style={{
              position: 'absolute',
              left: 144,
              right: 80,
              top: 71,
              fontSize: 19,
              letterSpacing: 2,
              fontWeight: 700,
              color: accent,
              overflowWrap: 'anywhere',
              opacity: Math.min(1, Math.max(0, frame / 12)),
            }}
          >
            {props.kicker}
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            left: 96,
            top: 198,
            width: safeWidth,
            height: 420,
            overflow: ['blur-rise', 'split-slide', 'elastic-stagger'].includes(props.mode) ? 'visible' : 'hidden',
            ...copyStyle,
            fontSize: fontSize ?? 104,
          }}
        >
          <EditorialWords props={props} frame={frame} durationInFrames={durationInFrames} />
        </div>
        <div style={{ position: 'absolute', left: 96, bottom: 67, width: 72, height: 3, backgroundColor: accent }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
