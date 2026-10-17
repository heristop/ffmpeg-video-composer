import { type RefObject, useEffect, useRef, useState } from 'react';
import { useObjectUrl } from '@/hooks/useObjectUrl';
import {
  type VideoEdit,
  type VideoTrim,
  type VideoCrop,
  isCropApplied,
  isTrimApplied,
} from '@/domain/valueObjects/videoEdits';
import { type VideoRect } from '@/features/editor/components/CropFrame';

export const FULL_CROP: VideoCrop = { x: 0, y: 0, w: 1, h: 1 };

export type Mode = 'trim' | 'crop';

/** Displayed-video rect inside a container, honoring object-contain. */
export function computeVideoRect(container: { width: number; height: number }, srcW: number, srcH: number): VideoRect {
  if (container.width <= 0 || container.height <= 0 || srcW <= 0 || srcH <= 0) {
    return { left: 0, top: 0, width: container.width, height: container.height };
  }

  const srcAspect = srcW / srcH;
  const containerAspect = container.width / container.height;

  if (srcAspect > containerAspect) {
    const width = container.width;
    const height = width / srcAspect;

    return { left: 0, top: (container.height - height) / 2, width, height };
  }

  const height = container.height;
  const width = height * srcAspect;

  return { left: (container.width - width) / 2, top: 0, width, height };
}

interface UseVideoEditorParams {
  file: File;
  edit: VideoEdit | undefined;
  onChange: (edit: VideoEdit | undefined) => void;
}

export interface UseVideoEditorResult {
  url: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  mode: Mode;
  currentTime: number;
  trim: VideoTrim;
  crop: VideoCrop;
  containerSize: { width: number; height: number };
  duration: number;
  videoRect: VideoRect;
  trimActive: boolean;
  cropActive: boolean;
  handleTrimChange: (next: VideoTrim) => void;
  handleCropChange: (next: VideoCrop) => void;
  resetTrim: () => void;
  resetCrop: () => void;
  switchMode: (next: Mode) => void;
  seek: (seconds: number) => void;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
}

/** Tracks an element's size via ResizeObserver. */
function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    const update = () => {
      if (el) {
        setSize({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    const observer = new ResizeObserver(update);

    if (el) {
      update();
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return size;
}

interface EditReporting {
  trim: VideoTrim;
  crop: VideoCrop;
  setTrim: (trim: VideoTrim) => void;
  handleTrimChange: (next: VideoTrim) => void;
  handleCropChange: (next: VideoCrop) => void;
  resetTrim: () => void;
  resetCrop: () => void;
}

/** Owns trim/crop state and reports only the meaningful edit to the parent. */
function useEditReporting(
  edit: VideoEdit | undefined,
  duration: number,
  onChange: (edit: VideoEdit | undefined) => void
): EditReporting {
  const [trim, setTrim] = useState<VideoTrim>(edit?.trim ?? { start: 0, end: 0 });
  const [crop, setCrop] = useState<VideoCrop>(edit?.crop ?? FULL_CROP);

  const report = (nextTrim: VideoTrim, nextCrop: VideoCrop) => {
    const next: VideoEdit = {};

    if (isTrimApplied(nextTrim, duration)) {
      next.trim = nextTrim;
    }

    if (isCropApplied(nextCrop)) {
      next.crop = nextCrop;
    }

    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const handleTrimChange = (next: VideoTrim) => {
    setTrim(next);
    report(next, crop);
  };

  const handleCropChange = (next: VideoCrop) => {
    setCrop(next);
    report(trim, next);
  };

  return {
    trim,
    crop,
    setTrim,
    handleTrimChange,
    handleCropChange,
    resetTrim: () => {
      handleTrimChange({ start: 0, end: duration });
    },
    resetCrop: () => {
      handleCropChange(FULL_CROP);
    },
  };
}

export function useVideoEditor({ file, edit, onChange }: UseVideoEditorParams): UseVideoEditorResult {
  const url = useObjectUrl(file) ?? '';
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>('trim');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [srcSize, setSrcSize] = useState<{ w: number; h: number } | null>(null);
  const containerSize = useElementSize(containerRef);

  const { trim, crop, setTrim, handleTrimChange, handleCropChange, resetTrim, resetCrop } = useEditReporting(
    edit,
    duration,
    onChange
  );

  const onLoadedMetadata = () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    setDuration(video.duration);
    setSrcSize({ w: video.videoWidth, h: video.videoHeight });

    if (!edit?.trim) {
      setTrim({ start: 0, end: video.duration });
    }
  };

  // Loop playback within the trim window so the preview reflects the trim.
  const onTimeUpdate = () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    setCurrentTime(video.currentTime);

    if (trim.end > 0 && video.currentTime >= trim.end - 0.05) {
      video.currentTime = trim.start;
    }
  };

  const switchMode = (next: Mode) => {
    const video = videoRef.current;

    if (next === 'crop') {
      video?.pause();
    }

    setMode(next);
  };

  const seek = (seconds: number) => {
    const video = videoRef.current;

    if (video) {
      video.currentTime = seconds;
    }
  };

  const videoRect = srcSize
    ? computeVideoRect(containerSize, srcSize.w, srcSize.h)
    : { left: 0, top: 0, width: containerSize.width, height: containerSize.height };

  return {
    url,
    videoRef,
    containerRef,
    mode,
    currentTime,
    trim,
    crop,
    containerSize,
    duration,
    videoRect,
    trimActive: isTrimApplied(trim, duration),
    cropActive: isCropApplied(crop),
    handleTrimChange,
    handleCropChange,
    resetTrim,
    resetCrop,
    switchMode,
    seek,
    onLoadedMetadata,
    onTimeUpdate,
  };
}
