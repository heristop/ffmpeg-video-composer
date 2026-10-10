// `?debugCamera=1`: measures what happens between pressing record and the first recorded frame, on the
// visitor's own camera, and shows it in a panel (and the console). It tells an encoder start-up stall
// (a slow "encoder ready") from a capture renegotiation (getUserMedia/applyConstraints calls or changed
// camera settings at record time) and from main-thread work (long tasks), on hardware and OS video
// effects a headless browser can't reproduce. A developer diagnostic: loaded only behind the flag, and
// its panel is not translated.

import { isWarmUpStream } from './video-encoder-warm-up';

export function cameraDebugRequested(search: string): boolean {
  return new URLSearchParams(search).get('debugCamera') === '1';
}

// Gaps between consecutive frame timestamps whose later frame falls inside [from, to].
function gapsIn(frames: number[], from: number, to: number): number[] {
  const gaps: number[] = [];

  for (let i = 1; i < frames.length; i++) {
    if (frames[i] >= from && frames[i] <= to) gaps.push(frames[i] - frames[i - 1]);
  }

  return gaps;
}

export function longestGap(frames: number[], from: number, to: number): number {
  return Math.round(Math.max(0, ...gapsIn(frames, from, to)));
}

export function medianGap(frames: number[], from: number, to: number): number {
  const gaps = gapsIn(frames, from, to).sort((a, b) => a - b);

  return Math.round(gaps[gaps.length >> 1] ?? 0);
}

type Settings = Record<string, unknown>;

const WATCHED_SETTINGS = ['width', 'height', 'frameRate', 'deviceId', 'aspectRatio', 'resizeMode'];

export function settingsChanges(before: Settings, after: Settings): string[] {
  return WATCHED_SETTINGS.filter((key) => before[key] !== after[key]).map(
    (key) => `${key} ${String(before[key])}→${String(after[key])}`
  );
}

interface StartSample {
  index: number;
  kind: 'take' | 'warm-up';
  mimeType: string | undefined;
  size: string;
  startCall: number;
  startEvent: number | null;
  frames: number[];
  longTasks: Array<{ start: number; duration: number }>;
  captureCalls: number;
  changes: string[];
}

// How long after a start the preview is watched for a freeze (longer when the encoder is slower).
const WATCH_MS = 2500;

function describeCaptureChanges(calls: number, changes: string[]): string {
  const parts = calls > 0 ? [`${calls} getUserMedia/applyConstraints call${calls === 1 ? '' : 's'}`] : [];

  return [...parts, ...changes].join('; ') || 'none';
}

export function summarizeStart(sample: StartSample) {
  const { startCall, startEvent, frames } = sample;
  const watchEnd = Math.max(startCall + WATCH_MS, (startEvent ?? 0) + 500);
  const longTasks = sample.longTasks
    .filter((task) => task.start >= startCall - 500 && task.start <= watchEnd)
    .reduce((sum, task) => sum + task.duration, 0);

  return {
    '#': sample.index,
    kind: sample.kind,
    size: sample.size,
    codec: sample.mimeType?.split('codecs=')[1] ?? 'default',
    'start→encoder ready (ms)': startEvent === null ? 'pending' : Math.round(startEvent - startCall),
    'preview frame (ms)': medianGap(frames, startCall - 3000, startCall - 500),
    'preview freeze (ms)': longestGap(frames, startCall, watchEnd),
    'long tasks (ms)': Math.round(longTasks),
    'capture changes': describeCaptureChanges(sample.captureCalls, sample.changes),
  };
}

// ── Browser glue (runs only behind the flag) ─────────────────────────────────

interface DebugState {
  frames: number[];
  longTasks: Array<{ start: number; duration: number }>;
  captureCalls: number;
  cameraSettings: Settings | null;
  cameraTrack: MediaStreamTrack | null;
  rows: Array<ReturnType<typeof summarizeStart>>;
  panel: HTMLPreElement | null;
}

function render(state: DebugState): void {
  if (!state.panel) {
    state.panel = document.createElement('pre');
    state.panel.setAttribute(
      'style',
      'position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:calc(100vw - 16px);overflow:auto;margin:0;padding:8px 10px;border-radius:8px;background:rgb(0 0 0/0.85);color:#9f9;font:11px/1.4 ui-monospace,monospace;pointer-events:none;white-space:pre'
    );
    document.body.append(state.panel);
  }

  const lines = state.rows.map((row) =>
    [
      `#${row['#']} ${row.kind} ${row.size} ${row.codec}`,
      `  encoder ready ${row['start→encoder ready (ms)']} ms · preview freeze ${row['preview freeze (ms)']} ms (frame ${row['preview frame (ms)']} ms)`,
      `  long tasks ${row['long tasks (ms)']} ms · capture changes: ${row['capture changes']}`,
    ].join('\n')
  );
  state.panel.textContent = ['debugCamera', ...lines].join('\n');
}

function watchPreview(state: DebugState): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');

  if (!descriptor?.set || !descriptor.get) return;

  const watched = new WeakSet<HTMLMediaElement>();
  const watchFrames = (video: HTMLVideoElement): void => {
    const onFrame = (now: number): void => {
      state.frames.push(now);
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  };
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return descriptor.get?.call(this) as MediaProvider | null;
    },
    set(this: HTMLMediaElement, value: MediaProvider | null) {
      descriptor.set?.call(this, value);
      const track = value instanceof MediaStream ? value.getVideoTracks()[0] : undefined;

      if (!track || !(this instanceof HTMLVideoElement)) return;

      // A new camera stream: count capture calls from here on.
      state.cameraTrack = track;
      state.cameraSettings = { ...track.getSettings() };
      state.captureCalls = 0;

      if (watched.has(this)) return;

      watched.add(this);
      watchFrames(this);
    },
  });
}

function watchCaptureCalls(state: DebugState): void {
  const devices = navigator.mediaDevices;
  const getUserMedia = devices.getUserMedia.bind(devices);
  devices.getUserMedia = (constraints) => {
    state.captureCalls += 1;

    return getUserMedia(constraints);
  };
  const applyConstraints = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'applyConstraints');

  if (!applyConstraints) return;

  Object.defineProperty(MediaStreamTrack.prototype, 'applyConstraints', {
    ...applyConstraints,
    value(this: MediaStreamTrack, constraints?: MediaTrackConstraints): Promise<void> {
      state.captureCalls += 1;

      return (applyConstraints.value as MediaStreamTrack['applyConstraints']).call(this, constraints);
    },
  });
}

function watchRecorders(state: DebugState): void {
  const Recorder = window.MediaRecorder;
  let count = 0;

  window.MediaRecorder = class extends Recorder {
    private readonly sample: StartSample;

    constructor(stream: MediaStream, options?: MediaRecorderOptions) {
      super(stream, options);
      count += 1;
      const settings = stream.getVideoTracks().at(0)?.getSettings();
      this.sample = {
        index: count,
        kind: isWarmUpStream(stream) ? 'warm-up' : 'take',
        mimeType: options?.mimeType,
        size: `${settings?.width ?? '?'}x${settings?.height ?? '?'}`,
        startCall: 0,
        startEvent: null,
        frames: state.frames,
        longTasks: state.longTasks,
        captureCalls: 0,
        changes: [],
      };
      this.addEventListener('start', () => {
        this.sample.startEvent = performance.now();
        // A start that lands after its row was written (a slow encoder) updates that row.
        const row = state.rows.findIndex((r) => r['#'] === this.sample.index);

        if (row < 0) return;

        state.rows[row] = summarizeStart(this.sample);
        render(state);
      });
    }

    override start(timeslice?: number): void {
      const sample = this.sample;
      sample.startCall = performance.now();
      sample.captureCalls = state.captureCalls;
      sample.changes =
        state.cameraSettings && state.cameraTrack
          ? settingsChanges(state.cameraSettings, { ...state.cameraTrack.getSettings() })
          : [];
      super.start(timeslice);
      window.setTimeout(() => {
        const row = summarizeStart(sample);
        state.rows.push(row);
        console.table([row]);
        render(state);
      }, WATCH_MS + 100);
    }
  };
}

export function installCameraDebug(): void {
  const state: DebugState = {
    frames: [],
    longTasks: [],
    captureCalls: 0,
    cameraSettings: null,
    cameraTrack: null,
    rows: [],
    panel: null,
  };

  watchPreview(state);
  watchCaptureCalls(state);
  watchRecorders(state);

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // No long-task timing in this browser; the other numbers still stand.
  }

  render(state);
}
