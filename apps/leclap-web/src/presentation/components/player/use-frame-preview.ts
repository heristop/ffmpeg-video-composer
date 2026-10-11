import { useEffect, useRef, type RefObject } from 'react';
import { quantizeTime } from './timeline.logic';

/** How finely the preview follows the pointer, in seconds. */
const STEP = 0.5;

// A muted, offscreen copy of the video to seek for previews; `onSeeked` paints each frame it lands on.
const createProbe = (source: string, onSeeked: () => void, onError: () => void): HTMLVideoElement => {
  const probe = document.createElement('video');

  probe.muted = true;
  probe.playsInline = true;
  probe.preload = 'auto';
  probe.src = source;
  probe.onseeked = onSeeked;
  probe.onerror = onError;

  return probe;
};

/**
 * Frames from the video under the seek bar's pointer, drawn into a small canvas. A second, muted copy of the video
 * (created on the first hover, never in the page) seeks to the hovered time, a half-second step at a time, and each
 * frame it lands on is painted into `canvasRef`. One seek runs at a time; a newer request waits for it and replaces
 * any older one, so a fast sweep never queues dozens. It reads the playing element's own source, so it works for a
 * local render as well as a public video.
 */
export function useFramePreview(videoRef: RefObject<HTMLVideoElement | null>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLVideoElement | null>(null);
  const busy = useRef(false);
  const pending = useRef<number | null>(null);
  const last = useRef(-1);

  useEffect(
    () => () => {
      const probe = probeRef.current;

      if (!probe) return;

      probe.removeAttribute('src');
      probe.load();
      probeRef.current = null;
    },
    []
  );

  const paint = () => {
    const probe = probeRef.current;
    const canvas = canvasRef.current;

    if (!probe || !canvas || probe.readyState < 2) return;

    canvas.getContext('2d')?.drawImage(probe, 0, 0, canvas.width, canvas.height);
  };

  const seek = (time: number) => {
    const probe = probeRef.current;

    if (!probe) return;

    if (busy.current) {
      pending.current = time;

      return;
    }

    busy.current = true;
    probe.currentTime = time;
  };

  const settle = () => {
    busy.current = false;
    paint();

    const next = pending.current;

    pending.current = null;

    if (next !== null) seek(next);
  };

  const probeFor = (source: string) => {
    if (probeRef.current?.src === source) return;

    probeRef.current = createProbe(source, settle, () => {
      busy.current = false;
    });
  };

  const request = (time: number) => {
    const source = videoRef.current?.currentSrc;
    const step = quantizeTime(time, STEP);

    if (!source || step === last.current) {
      paint();

      return;
    }

    last.current = step;
    probeFor(source);
    seek(step);
  };

  return { canvasRef, request };
}
