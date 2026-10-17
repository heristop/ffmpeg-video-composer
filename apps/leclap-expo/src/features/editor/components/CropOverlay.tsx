import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { colors } from '@/src/styles/theme';

/** A rectangle in the displayed video's coordinate space, in screen pixels. */
export interface VideoRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Crop selection normalized to the source frame (0..1). */
export interface NormalizedCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const MIN_SIZE = 0.12; // smallest crop is 12% of the frame
const HANDLE = 28;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Per-corner resize math. Each anchors the opposite corner and enforces min size. */
const cornerResizers: Record<Corner, (start: NormalizedCrop, dnx: number, dny: number) => NormalizedCrop> = {
  tl: (start, dnx, dny) => {
    const right = start.x + start.w;
    const bottom = start.y + start.h;
    const x = clamp(start.x + dnx, 0, right - MIN_SIZE);
    const y = clamp(start.y + dny, 0, bottom - MIN_SIZE);

    return { x, y, w: right - x, h: bottom - y };
  },
  tr: (start, dnx, dny) => {
    const bottom = start.y + start.h;
    const y = clamp(start.y + dny, 0, bottom - MIN_SIZE);

    return { x: start.x, y, w: clamp(start.w + dnx, MIN_SIZE, 1 - start.x), h: bottom - y };
  },
  bl: (start, dnx, dny) => {
    const right = start.x + start.w;
    const x = clamp(start.x + dnx, 0, right - MIN_SIZE);

    return { x, y: start.y, w: right - x, h: clamp(start.h + dny, MIN_SIZE, 1 - start.y) };
  },
  br: (start, dnx, dny) => ({
    x: start.x,
    y: start.y,
    w: clamp(start.w + dnx, MIN_SIZE, 1 - start.x),
    h: clamp(start.h + dny, MIN_SIZE, 1 - start.y),
  }),
};

/**
 * Compute a new normalized crop when dragging a given corner by (dnx, dny) (normalized deltas).
 * The opposite corner stays anchored; min size is enforced.
 */
function resizeByCorner(start: NormalizedCrop, corner: Corner, dnx: number, dny: number): NormalizedCrop {
  return cornerResizers[corner](start, dnx, dny);
}

function CornerHandle({
  corner,
  rect,
  videoRect,
  crop,
  onChange,
}: {
  corner: Corner;
  rect: VideoRect; // pixel rect of the crop frame
  videoRect: VideoRect;
  crop: NormalizedCrop;
  onChange: (next: NormalizedCrop) => void;
}) {
  const cropRef = useRef(crop);
  const videoRectRef = useRef(videoRect);
  const onChangeRef = useRef(onChange);
  const startRef = useRef<NormalizedCrop>(crop);

  useEffect(() => {
    cropRef.current = crop;
    videoRectRef.current = videoRect;
    onChangeRef.current = onChange;
  }, [crop, videoRect, onChange]);

  const [responder, setResponder] = useState<ReturnType<typeof PanResponder.create> | null>(null);

  useEffect(() => {
    const nextResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = cropRef.current;
      },
      onPanResponderMove: (_e, gesture) => {
        const currentVideoRect = videoRectRef.current;
        const dnx = gesture.dx / currentVideoRect.width;
        const dny = gesture.dy / currentVideoRect.height;
        onChangeRef.current(resizeByCorner(startRef.current, corner, dnx, dny));
      },
    });
    const timer = setTimeout(() => {
      setResponder(nextResponder);
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [corner]);

  const isLeft = corner === 'tl' || corner === 'bl';
  const isTop = corner === 'tl' || corner === 'tr';

  return (
    <View
      {...(responder?.panHandlers ?? {})}
      style={[
        styles.handle,
        {
          left: isLeft ? rect.left - HANDLE / 2 : rect.left + rect.width - HANDLE / 2,
          top: isTop ? rect.top - HANDLE / 2 : rect.top + rect.height - HANDLE / 2,
        },
      ]}
    >
      <View style={styles.handleDot} />
    </View>
  );
}

/**
 * Draggable + resizable crop frame rendered over the displayed video. Reports the crop
 * normalized to the source frame so it is resolution-independent.
 */
export function CropOverlay({
  videoRect,
  crop,
  onChange,
}: {
  videoRect: VideoRect;
  crop: NormalizedCrop;
  onChange: (next: NormalizedCrop) => void;
}) {
  const videoRectRef = useRef(videoRect);
  const onChangeRef = useRef(onChange);
  const cropRef = useRef(crop);
  useEffect(() => {
    videoRectRef.current = videoRect;
    onChangeRef.current = onChange;
    cropRef.current = crop;
  }, [videoRect, onChange, crop]);

  const moveStart = useRef<NormalizedCrop>(crop);
  const [moveResponder, setMoveResponder] = useState<ReturnType<typeof PanResponder.create> | null>(null);

  useEffect(() => {
    const nextResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        moveStart.current = cropRef.current;
      },
      onPanResponderMove: (_e, gesture) => {
        const currentVideoRect = videoRectRef.current;
        const dnx = gesture.dx / currentVideoRect.width;
        const dny = gesture.dy / currentVideoRect.height;
        onChangeRef.current({
          ...moveStart.current,
          x: clamp(moveStart.current.x + dnx, 0, 1 - moveStart.current.w),
          y: clamp(moveStart.current.y + dny, 0, 1 - moveStart.current.h),
        });
      },
    });
    const timer = setTimeout(() => {
      setMoveResponder(nextResponder);
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Pixel rect of the crop frame within the screen.
  const rect: VideoRect = {
    left: videoRect.left + crop.x * videoRect.width,
    top: videoRect.top + crop.y * videoRect.height,
    width: crop.w * videoRect.width,
    height: crop.h * videoRect.height,
  };

  const corners: Corner[] = ['tl', 'tr', 'bl', 'br'];

  return (
    <>
      {/* Dim mask around the crop region (four bands). */}
      <View
        pointerEvents="none"
        style={[
          styles.mask,
          { left: videoRect.left, top: videoRect.top, width: videoRect.width, height: rect.top - videoRect.top },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.mask,
          {
            left: videoRect.left,
            top: rect.top + rect.height,
            width: videoRect.width,
            height: videoRect.top + videoRect.height - (rect.top + rect.height),
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.mask,
          { left: videoRect.left, top: rect.top, width: rect.left - videoRect.left, height: rect.height },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.mask,
          {
            left: rect.left + rect.width,
            top: rect.top,
            width: videoRect.left + videoRect.width - (rect.left + rect.width),
            height: rect.height,
          },
        ]}
      />

      {/* Draggable crop frame body. */}
      <View
        {...(moveResponder?.panHandlers ?? {})}
        style={[styles.frame, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }]}
      >
        {/* Rule-of-thirds guides */}
        <View pointerEvents="none" style={[styles.gridLineV, { left: '33.33%' }]} />
        <View pointerEvents="none" style={[styles.gridLineV, { left: '66.66%' }]} />
        <View pointerEvents="none" style={[styles.gridLineH, { top: '33.33%' }]} />
        <View pointerEvents="none" style={[styles.gridLineH, { top: '66.66%' }]} />
      </View>

      {corners.map((c) => (
        <CornerHandle key={c} corner={c} rect={rect} videoRect={videoRect} crop={crop} onChange={onChange} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  frame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  handleDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.primary,
  },
});

export default CropOverlay;
