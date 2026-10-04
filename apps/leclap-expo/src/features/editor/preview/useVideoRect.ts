import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import type { VideoRect } from '@/src/features/editor/components/CropOverlay';
import { computeVideoRect } from './previewHelpers';

interface UseVideoRectResult {
  videoRect: VideoRect;
  containerWidth: number;
  containerHeight: number;
  onContainerLayout: (e: LayoutChangeEvent) => void;
}

/**
 * Tracks the on-screen video container size and derives the displayed-video
 * rectangle (honoring contentFit="contain"), falling back to the expected
 * aspect ratio until the real source size is known.
 */
export function useVideoRect(
  srcSize: { width: number; height: number } | null,
  requiredOrientation: 'portrait' | 'landscape' | 'square'
): UseVideoRectResult {
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const onContainerLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  };

  const fallbackAspect = { square: 1, portrait: 9 / 16, landscape: 16 / 9 }[requiredOrientation];
  const videoRect = srcSize
    ? computeVideoRect(containerSize, srcSize.width, srcSize.height)
    : computeVideoRect(containerSize, fallbackAspect * 1000, 1000);

  return { videoRect, containerWidth: containerSize.width, containerHeight: containerSize.height, onContainerLayout };
}
