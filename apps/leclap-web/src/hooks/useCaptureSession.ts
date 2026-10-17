import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureMode, TemplateOrientation } from '@leclap/creative-kit';
import i18n from '@/i18n';
import { useCameraCapture, pickMimeType } from './useCameraCapture';
import { useObjectUrl } from './useObjectUrl';

export type CaptureState = 'loading' | 'idle' | 'countdown' | 'recording' | 'preview' | 'error';

export interface CaptureSessionConfig {
  defaultMode: CaptureMode;
  allowedModes: CaptureMode[];
  countdown?: number;
  maxDuration?: number;
  orientation?: TemplateOrientation;
}

export interface CaptureSessionReturn {
  mode: CaptureMode;
  setMode: (m: CaptureMode) => void;
  /** All modes the user can switch to — pass directly to the mode tab bar. */
  allowedModes: CaptureMode[];
  /** Live display stream for screen mode; null in camera/upload mode (camera uses videoRef). */
  previewStream: MediaStream | null;
  state: CaptureState;
  /** Camera modes: triggers countdown then recording. Screen: starts recording. Upload: opens file picker. */
  start: () => void;
  stop: () => void;
  /** File produced by record/upload; null while idle or recording. For camera modes this is only set
   * once `confirm()` runs — use `previewUrl` to show the recorded clip during the preview state. */
  result: File | null;
  /** Object URL of the just-recorded/-picked clip, for the preview player (camera blob during preview,
   * or the selected screen/upload file). Null when there's nothing to preview. */
  previewUrl: string | null;
  /** Confirm and accept the captured result (calls underlying confirmCapture for camera). */
  confirm: () => void;
  /** Retake / discard current result and go back to ready state. */
  retake: () => void;
  /** Open the file picker — no-op unless mode === 'upload'. */
  openFilePicker: () => void;
  /** videoRef for camera modes — attach to the <video> preview element. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Timer seconds elapsed during recording. */
  elapsed: number;
  /** True when nearing maxDuration (last ~3s). */
  endingSoon: boolean;
  /** Countdown value (null when not counting down). */
  countdownValue: number | null;
  error: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stopTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

// Map camera's 'ready' to the unified 'idle' state label.
function mapCameraState(m: 'loading' | 'ready' | 'countdown' | 'recording' | 'preview' | 'error'): CaptureState {
  if (m === 'ready') return 'idle';

  return m;
}

// ── useScreenCapture ──────────────────────────────────────────────────────────

interface ScreenCaptureController {
  stream: MediaStream | null;
  state: CaptureState;
  file: File | null;
  elapsed: number;
  error: string;
  start: () => void;
  stop: () => void;
  retake: () => void;
}

function useScreenCapture(active: boolean): ScreenCaptureController {
  const [screen, setScreen] = useState({
    active,
    stream: null as MediaStream | null,
    state: 'idle' as CaptureState,
    file: null as File | null,
    elapsed: 0,
    error: '',
  });

  if (screen.active !== active) {
    setScreen({ active, stream: null, state: 'idle', file: null, elapsed: 0, error: '' });
  }

  const { stream, state, file, elapsed, error } = screen;
  const streamRef = useRef<MediaStream | null>(null);
  const setStream = (next: MediaStream | null) => {
    streamRef.current = next;
    setScreen((current) => ({ ...current, stream: next }));
  };
  const setState = (next: CaptureState) => {
    setScreen((current) => ({ ...current, state: next }));
  };
  const setFile = (next: File | null) => {
    setScreen((current) => ({ ...current, file: next }));
  };
  const setElapsed = (next: number | ((current: number) => number)) => {
    setScreen((current) => ({ ...current, elapsed: typeof next === 'function' ? next(current.elapsed) : next }));
  };
  const setError = (next: string) => {
    setScreen((current) => ({ ...current, error: next }));
  };
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Tear down when deactivated
  useEffect(() => {
    if (active) return () => {};

    recorderRef.current?.stop();
    recorderRef.current = null;
    chunksRef.current = [];
    stopTracks(streamRef.current);

    return () => {};
  }, [active]);

  // Acquire display media when activated
  useEffect(() => {
    if (!active) return () => {};

    let cancelled = false;

    const acquire = async () => {
      try {
        const acquired = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

        if (cancelled) {
          stopTracks(acquired);

          return;
        }

        setStream(acquired);
        setState('idle');
      } catch {
        if (!cancelled) {
          setError(i18n.t('media:camera.errors.screenDenied'));
          setState('error');
        }
      }
    };

    acquire().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [active]);

  // Recording timer
  useEffect(() => {
    if (state !== 'recording') return () => {};

    const id = window.setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, [state]);

  const start = useCallback(() => {
    if (!stream) return;

    const mimeType = pickMimeType();
    chunksRef.current = [];

    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setError(i18n.t('media:camera.errors.screenFailed'));
      setState('error');

      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      setError(i18n.t('media:camera.errors.screenFailed'));
      setState('error');
    };

    recorder.onstop = () => {
      const type = mimeType ?? 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      setFile(new File([blob], `screen-${Date.now()}.${ext}`, { type }));
      setState('preview');
    };

    try {
      recorder.start();
    } catch {
      setError(i18n.t('media:camera.errors.screenFailed'));
      setState('error');

      return;
    }

    recorderRef.current = recorder;
    setElapsed(0);
    setState('recording');
  }, [stream]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const retake = useCallback(() => {
    setFile(null);
    setState('idle');
  }, []);

  return { stream, state, file, elapsed, error, start, stop, retake };
}

// ── useUploadCapture ──────────────────────────────────────────────────────────

interface UploadCaptureController {
  file: File | null;
  openPicker: () => void;
  retake: () => void;
}

function useUploadCapture(): UploadCaptureController {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];

      if (file) {
        setFile(file);
        input.value = '';
      }
    });
    document.body.appendChild(input);
    inputRef.current = input;

    return () => {
      document.body.removeChild(input);
      inputRef.current = null;
    };
  }, []);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const retake = useCallback(() => {
    setFile(null);

    if (inputRef.current) inputRef.current.value = '';
  }, []);

  return { file, openPicker, retake };
}

// ── Derived unified values ────────────────────────────────────────────────────

interface DerivedValues {
  state: CaptureState;
  result: File | null;
  elapsed: number;
  endingSoon: boolean;
  countdownValue: number | null;
  error: string;
}

function deriveForCamera(camera: ReturnType<typeof useCameraCapture>, capturedFile: File | null): DerivedValues {
  return {
    state: mapCameraState(camera.mode),
    result: capturedFile,
    elapsed: camera.elapsed,
    endingSoon: camera.endingSoon,
    countdownValue: camera.countdownValue,
    error: camera.error,
  };
}

function deriveForScreen(screen: ScreenCaptureController): DerivedValues {
  return {
    state: screen.state,
    result: screen.file,
    elapsed: screen.elapsed,
    endingSoon: false,
    countdownValue: null,
    error: screen.error,
  };
}

function deriveForUpload(uploadFile: File | null): DerivedValues {
  return {
    state: uploadFile ? 'preview' : 'idle',
    result: uploadFile,
    elapsed: 0,
    endingSoon: false,
    countdownValue: null,
    error: '',
  };
}

// ── useCaptureSession ─────────────────────────────────────────────────────────

export function useCaptureSession(config: CaptureSessionConfig): CaptureSessionReturn {
  const [mode, setModeState] = useState<CaptureMode>(config.defaultMode);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);

  const handleCameraCapture = useCallback((file: File) => {
    setCapturedFile(file);
  }, []);

  const cameraOptions = useMemo(
    () => ({
      countdownSeconds: config.countdown,
      maxDurationSeconds: config.maxDuration,
      orientation: config.orientation,
    }),
    [config.countdown, config.maxDuration, config.orientation]
  );

  // Always call all sub-hooks unconditionally (Rules of Hooks)
  const camera = useCameraCapture(handleCameraCapture, () => {}, cameraOptions);

  const screen = useScreenCapture(mode === 'screen');
  const upload = useUploadCapture();

  const isCameraMode = mode === 'front' || mode === 'back';

  const setMode = useCallback(
    (m: CaptureMode) => {
      setModeState((prev) => {
        if (m === prev) return prev;

        setCapturedFile(null);

        if (m === 'front' && camera.facingMode !== 'user') camera.switchCamera();

        if (m === 'back' && camera.facingMode !== 'environment') camera.switchCamera();

        // Release camera stream when leaving camera modes
        if ((prev === 'front' || prev === 'back') && m !== 'front' && m !== 'back') {
          camera.cancel();
        }

        return m;
      });
    },
    [camera]
  );

  // Derive unified state from the active sub-controller
  function derivedValues(): DerivedValues {
    if (isCameraMode) return deriveForCamera(camera, capturedFile);

    if (mode === 'screen') return deriveForScreen(screen);

    return deriveForUpload(upload.file);
  }

  const derived = derivedValues();

  // The clip to show in the preview player. Camera keeps the recorded blob URL in `camera.previewUrl`
  // during the preview state (its `result`/capturedFile is only set on confirm); screen/upload already
  // have the file, so derive a URL from it.
  const resultUrl = useObjectUrl(isCameraMode ? undefined : (derived.result ?? undefined));
  const previewUrl = isCameraMode ? camera.previewUrl : resultUrl;

  const start = useCallback(() => {
    if (isCameraMode) {
      camera.startRecording();

      return;
    }

    if (mode === 'screen') {
      screen.start();

      return;
    }

    upload.openPicker();
  }, [isCameraMode, mode, camera, screen, upload]);

  const stop = useCallback(() => {
    if (isCameraMode) {
      camera.stopRecording();

      return;
    }

    if (mode === 'screen') screen.stop();
  }, [isCameraMode, mode, camera, screen]);

  const confirm = useCallback(() => {
    if (isCameraMode) camera.confirmCapture();
    // screen/upload: result is already in state; consumer reads `result` directly
  }, [isCameraMode, camera]);

  const retake = useCallback(() => {
    setCapturedFile(null);

    if (isCameraMode) {
      camera.retake();

      return;
    }

    if (mode === 'screen') {
      screen.retake();

      return;
    }

    upload.retake();
  }, [isCameraMode, mode, camera, screen, upload]);

  const openFilePicker = useCallback(() => {
    if (mode !== 'upload') return;

    upload.openPicker();
  }, [mode, upload]);

  return {
    mode,
    setMode,
    allowedModes: config.allowedModes,
    previewStream: mode === 'screen' ? screen.stream : null,
    state: derived.state,
    start,
    stop,
    result: derived.result,
    previewUrl,
    confirm,
    retake,
    openFilePicker,
    videoRef: camera.videoRef,
    elapsed: derived.elapsed,
    endingSoon: derived.endingSoon,
    countdownValue: derived.countdownValue,
    error: derived.error,
  };
}
