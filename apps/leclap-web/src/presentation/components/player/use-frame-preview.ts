import { useEffect, useRef, useState, type RefObject } from 'react';
import { quantizeTime } from './timeline.logic';

/** How finely the preview follows the pointer, in seconds. */
const STEP = 0.5;

// A source on another origin is fetched with CORS, so the frames it paints never taint the canvas; the site's own
// files and a local render (blob:) need nothing.
const crossOrigin = (source: string): boolean => {
  if (source.startsWith('blob:') || source.startsWith('data:')) return false;

  return new URL(source, globalThis.location.href).origin !== globalThis.location.origin;
};

interface ProbeEvents {
  onReady: () => void;
  onSeeked: () => void;
  onError: () => void;
}

// A muted, offscreen copy of the video to seek for previews.
const createProbe = (source: string, events: ProbeEvents): HTMLVideoElement => {
  const probe = document.createElement('video');

  if (crossOrigin(source)) probe.crossOrigin = 'anonymous';

  probe.muted = true;
  probe.playsInline = true;
  probe.preload = 'auto';
  probe.onloadedmetadata = events.onReady;
  probe.onseeked = events.onSeeked;
  probe.onerror = events.onError;
  probe.src = source;

  return probe;
};

/**
 * Frames from the video under the seek bar's pointer, drawn into a small canvas. A second, muted copy of the video
 * (created on the first hover, never in the page) seeks to the hovered time, a half-second step at a time, and once
 * `seeked` fires the frame it landed on is painted into `canvasRef`. Seeks are throttled: one runs at a time, and a
 * newer request waits for it and replaces any older one, so a fast scrub never queues dozens; a request made before
 * the copy has its metadata waits for it (a seek then would never report back). `painted` is the step on the canvas,
 * so the preview can shimmer until the hovered frame arrives. It reads the playing element's own source, so it
 * works for a local render as well as a public video.
 */
export function useFramePreview(videoRef: RefObject<HTMLVideoElement | null>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLVideoElement | null>(null);
  const busy = useRef(false);
  const target = useRef(-1);
  const pending = useRef<number | null>(null);
  const [painted, setPainted] = useState(-1);

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
    setPainted(target.current);
  };

  const seek = (time: number) => {
    const probe = probeRef.current;

    if (!probe) return;

    if (busy.current || probe.readyState < 1) {
      pending.current = time;

      return;
    }

    busy.current = true;
    target.current = time;
    probe.currentTime = time;
  };

  const next = () => {
    const queued = pending.current;

    pending.current = null;

    if (queued !== null) seek(queued);
  };

  const probeFor = (source: string) => {
    if (probeRef.current?.src === source) return;

    busy.current = false;
    probeRef.current = createProbe(source, {
      onReady: next,
      onSeeked: () => {
        busy.current = false;
        paint();
        next();
      },
      onError: () => {
        busy.current = false;
      },
    });
  };

  const request = (time: number) => {
    const source = videoRef.current?.currentSrc;
    const step = quantizeTime(time, STEP);

    if (!source || step === target.current || step === pending.current) return;

    probeFor(source);
    seek(step);
  };

  return {
    canvasRef,
    request,
    /** Whether the canvas holds the frame for `time` yet. */
    shows: (time: number) => quantizeTime(time, STEP) === painted,
  };
}
