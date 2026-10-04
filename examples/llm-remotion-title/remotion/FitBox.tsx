import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { continueRender, delayRender } from 'remotion';

/** Mounted only after the exact FontFace is ready. Measure complete DOM groups, then gate capture
 * until the fitted transform is committed. Measurements never depend on animation/frame time. */
export function FitBox({
  children,
  width,
  height,
  center = false,
}: {
  children: ReactNode;
  width: number;
  height: number;
  center?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [handle] = useState(() => delayRender('Measure exact-font promo layout'));
  const [size, setSize] = useState<{ scale: number; height: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const node = content.current;

    if (!node) return;
    let measuredWidth = Math.max(width, node.scrollWidth);
    const descendants = node.querySelectorAll<HTMLElement>('*');

    for (const child of descendants) {
      measuredWidth = Math.max(measuredWidth, child.scrollWidth);
    }
    const measuredHeight = Math.max(1, node.scrollHeight);
    // Small inset accommodates glyph overhang and fractional browser rounding.
    setSize({
      scale: Math.min(1, (width - 4) / measuredWidth, (height - 4) / measuredHeight),
      height: measuredHeight,
      width: measuredWidth,
    });
  }, [children, width, height]);
  useLayoutEffect(() => {
    if (size) continueRender(handle);
  }, [size, handle]);

  const scale = size?.scale ?? 1;

  return (
    <div data-promo-fit-box style={{ position: 'relative', width, height }}>
      <div
        ref={content}
        data-promo-fit-content
        style={{
          position: 'absolute',
          width,
          display: 'flex',
          flexDirection: 'column',
          alignItems: center ? 'center' : 'flex-start',
          top: size ? (height - size.height * scale) / 2 : 0,
          left: (width - (center ? width : (size?.width ?? width)) * scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          opacity: size ? 1 : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
