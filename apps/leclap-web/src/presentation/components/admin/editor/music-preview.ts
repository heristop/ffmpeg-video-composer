import { useEffect, useSyncExternalStore } from 'react';

// One shared <audio> for every track preview in the template editor: the track list and the program
// monitor both drive it, so starting a track anywhere stops whatever was playing, and both surfaces
// show the same state and playhead. The last surface to unmount stops it, so leaving the music scene
// never leaves a track running.

export type PreviewStatus = 'idle' | 'loading' | 'playing' | 'error';

export interface PreviewState {
  trackId: string | null;
  status: PreviewStatus;
  currentTime: number;
  duration: number;
}

export interface PreviewTrack {
  id: string;
  url: string;
  durationSec?: number;
}

const IDLE: PreviewState = { trackId: null, status: 'idle', currentTime: 0, duration: 0 };

let state: PreviewState = IDLE;
let audio: HTMLAudioElement | null = null;
let frame = 0;
let users = 0;
const listeners = new Set<() => void>();
const startListeners = new Set<() => void>();

function emit(next: Partial<PreviewState>) {
  state = { ...state, ...next };

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function previewSnapshot(): PreviewState {
  return state;
}

// The playhead follows the audio clock every frame while playing; `timeupdate` alone ticks at ~4 Hz,
// which reads as a stutter on a thin progress line.
function followClock() {
  cancelAnimationFrame(frame);

  const tick = () => {
    if (!audio || state.status !== 'playing') return;

    emit({ currentTime: audio.currentTime });
    frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);
}

function element(): HTMLAudioElement {
  if (audio) return audio;

  const created = new Audio();
  created.preload = 'none';
  created.addEventListener('playing', () => {
    emit({ status: 'playing', duration: Number.isFinite(created.duration) ? created.duration : state.duration });
    followClock();
  });
  created.addEventListener('waiting', () => {
    emit({ status: 'loading' });
  });
  created.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(created.duration)) emit({ duration: created.duration });
  });
  created.addEventListener('ended', () => {
    emit({ status: 'idle', currentTime: 0 });
  });
  created.addEventListener('error', () => {
    if (state.trackId) emit({ status: 'error' });
  });
  audio = created;

  return created;
}

export function stopPreview() {
  cancelAnimationFrame(frame);
  audio?.pause();

  if (state.status !== 'idle' || state.trackId !== null) emit(IDLE);
}

// Start a track, or stop it when it is the one already sounding (or loading).
export function togglePreview(track: PreviewTrack) {
  const sounding = state.trackId === track.id && (state.status === 'playing' || state.status === 'loading');

  if (sounding) {
    stopPreview();

    return;
  }

  // Another sound source (the program monitor's playback) stands down when a preview starts.
  for (const listener of startListeners) listener();

  const media = element();
  media.pause();
  media.src = track.url;
  media.currentTime = 0;
  emit({ trackId: track.id, status: 'loading', currentTime: 0, duration: track.durationSec ?? 0 });

  media.play().catch((error: unknown) => {
    // A newer toggle aborting this one is not a failure worth showing.
    if (error instanceof DOMException && error.name === 'AbortError') return;

    if (state.trackId === track.id) emit({ status: 'error' });
  });
}

// Runs `listener` whenever a track preview starts; returns the unsubscribe.
export function onPreviewStart(listener: () => void): () => void {
  startListeners.add(listener);

  return () => {
    startListeners.delete(listener);
  };
}

// The shared preview state, plus the guarantee that the preview stops once no surface shows it.
export function useMusicPreview(): PreviewState {
  useEffect(() => {
    users += 1;

    return () => {
      users -= 1;

      if (users === 0) stopPreview();
    };
  }, []);

  return useSyncExternalStore(subscribe, previewSnapshot, previewSnapshot);
}

// The length to show for a track: the element's once it has loaded, the catalog's before that.
export function trackDuration(preview: PreviewState | null, durationSec?: number): number {
  if (preview && preview.duration > 0) return preview.duration;

  return durationSec ?? 0;
}

// How far through the track the playhead sits, 0..1.
export function playheadRatio(preview: PreviewState | null, duration: number): number {
  if (!preview || duration <= 0) return 0;

  return Math.min(preview.currentTime / duration, 1);
}

// 0:07, 2:52 — minutes are not zero-padded, seconds are.
export function formatTrackTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;

  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
