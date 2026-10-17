import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { X, Check, RotateCcw, Loader2, CameraOff, TimerReset } from '@/presentation/components/icons';
import { SwitchCameraIcon } from '@/presentation/components/icons/switch-camera';
import { useIconHover } from '@/presentation/components/icons/useIconHover';
import clsx from 'clsx';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatElapsed, type CaptureOrientation } from '@/hooks/useCameraCapture';
import { useCaptureSession, type CaptureState } from '@/hooks/useCaptureSession';
import type { CaptureMode } from '@leclap/creative-kit';
import { Button } from '@/presentation/components/ui';
import { VideoPreview } from '@/presentation/components/VideoPreview';
import { FramingGuideOverlay } from '@/presentation/components/FramingGuideOverlay';
import { ClappyCountdown } from '@/presentation/components/clappy';
import type { FramingGuideConfig } from 'ffmpeg-video-composer/src/core/types.d.ts';

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  // When > 0, a 3·2·1 countdown plays before recording starts.
  countdownSeconds?: number;
  // The target clip duration; drives the "wrap up" warning in its last seconds.
  maxDurationSeconds?: number;
  // Camera framing guide overlay — shown over the live stream only, never burned into video.
  framingGuide?: FramingGuideConfig;
  // Author's "what to film" prompt, shown as a muted caption over the live preview.
  description?: string;
  // Template orientation: frames the camera as a centered 9:16 ('portrait'), 1:1 ('square'), or full
  // stage ('landscape') box, and records to that aspect.
  orientation?: CaptureOrientation;
  /** Default mode when the panel opens (from template). Falls back to 'front'. */
  defaultCaptureMode?: CaptureMode;
  /** Modes available to the user. Falls back to ['front','back','screen','upload']. */
  allowedCaptureModes?: CaptureMode[];
}

// ── Mode tab bar ──────────────────────────────────────────────────────────────

function CaptureModeBar({
  modes,
  active,
  onChange,
}: {
  modes: CaptureMode[];
  active: CaptureMode;
  onChange: (m: CaptureMode) => void;
}) {
  const { t } = useTranslation('media');

  if (modes.length <= 1) return null;

  return (
    // Scrolls rather than overflowing when four modes and a wordy locale outgrow a phone's width.
    <div className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-black/60 p-1 ring-1 ring-white/20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {modes.map((m) => (
        <button
          key={m}
          onClick={() => {
            onChange(m);
          }}
          className={clsx(
            // min-h-11 keeps each mode a 44px touch target — it is the first control a phone user
            // hits, and py-1.5 alone left it around 30px.
            'flex min-h-11 shrink-0 min-w-[3.75rem] items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-all sm:min-h-0 sm:min-w-[4.75rem] sm:px-4 sm:py-1.5',
            active === m
              ? 'bg-white font-semibold text-black shadow-sm'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          )}
        >
          {t(`camera.modes.${m}`)}
        </button>
      ))}
    </div>
  );
}

// ── Screen preview helper ─────────────────────────────────────────────────────

function ScreenPreview({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return <video ref={ref} autoPlay muted className="w-full h-full object-contain" />;
}

// ── Top bar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  state: CaptureState;
  mode: CaptureMode;
  elapsed: number;
  onCancel: () => void;
  onSwitchCamera: () => void;
}

const CameraTopBar = ({ state, mode, elapsed, onCancel, onSwitchCamera }: TopBarProps) => {
  const { t } = useTranslation('media');
  const isCameraMode = mode === 'front' || mode === 'back';
  const showSwitch = isCameraMode && (state === 'idle' || state === 'loading');
  const showSpacer = state === 'preview' || state === 'error';
  const { ref: switchRef, hoverProps: switchHoverProps } = useIconHover();

  return (
    <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <Button
        variant="ghost"
        size="icon"
        onClick={onCancel}
        className="rounded-full bg-foreground/10 text-foreground hover:bg-foreground/20"
        aria-label={t('camera.closeAria')}
      >
        <X />
      </Button>

      {state === 'recording' && (
        <div className="fade-in flex items-center gap-2.5 px-4 py-2 rounded-full bg-black/70 ring-1 ring-white/20 shadow-lg shadow-black/40">
          <span className="w-3 h-3 rounded-full bg-[var(--color-error)] animate-pulse shadow-[0_0_10px_2px_oklch(0.643_0.215_28.8/0.6)]" />
          <span className="text-lg font-bold text-white tabular-nums tracking-tight">{formatElapsed(elapsed)}</span>
        </div>
      )}

      {showSwitch && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onSwitchCamera}
          className="rounded-full bg-foreground/10 text-foreground hover:bg-foreground/20"
          aria-label={t('camera.switchAria')}
          {...switchHoverProps}
        >
          <SwitchCameraIcon ref={switchRef} size={16} />
        </Button>
      )}

      {showSpacer && <span className="w-10" />}
    </div>
  );
};

// ── Error view ────────────────────────────────────────────────────────────────

interface ErrorViewProps {
  error: string;
  onRetry: () => void;
}

const CameraErrorView = ({ error, onRetry }: ErrorViewProps) => {
  const { t } = useTranslation('media');

  return (
    <div className="max-w-sm mx-auto text-center px-6 fade-in">
      <div className="pop-in inline-flex p-4 rounded-2xl bg-[var(--color-error)]/15 border border-[var(--color-error)]/30 mb-4">
        <CameraOff className="w-8 h-8 text-[var(--color-error)]" />
      </div>
      <h2 className="text-xl font-bold font-display text-foreground mb-2">{t('camera.unavailable')}</h2>
      <p className="text-foreground/80 mb-6 text-balance">{error}</p>
      <Button onClick={onRetry} size="lg">
        <RotateCcw /> {t('actions.tryAgain', { ns: 'common' })}
      </Button>
    </div>
  );
};

// How long "Action!" holds into the recording: Clappy's slam lands 0.12s into it and he has settled by
// ~0.7s. The overlay is page chrome, so the beat is seen and never recorded.
const ACTION_BEAT_MS = 700;

const CountdownCopy = ({ value, counting, t }: { value: number | null; counting: boolean; t: TFunction<'media'> }) =>
  counting ? (
    <>
      <span
        key={value}
        className="pop-in -mt-1 block font-display font-extrabold leading-none text-white tabular-nums text-[6rem] sm:text-[8rem] [text-shadow:0_4px_28px_oklch(0_0_0/0.6)]"
      >
        {value}
      </span>
      <p className="mt-1 text-sm font-semibold uppercase tracking-[0.2em] text-white/85">{t('camera.getReady')}</p>
    </>
  ) : (
    <span className="pop-in mt-3 block font-display text-4xl font-extrabold uppercase tracking-wide text-white sm:text-5xl [text-shadow:0_4px_28px_oklch(0_0_0/0.6)]">
      {t('camera.action')}
    </span>
  );

// True for the moment right after a countdown hands over to the recording — the slate's "Action!".
// A countdown the user cancels goes back to idle instead, and gets no slam.
const useActionBeat = (state: CaptureState): boolean => {
  const [beat, setBeat] = useState(false);
  const previous = useRef(state);

  useEffect(() => {
    const counted = previous.current === 'countdown';
    previous.current = state;

    if (!counted || state !== 'recording') {
      setBeat(false);

      return () => {};
    }

    setBeat(true);
    const id = window.setTimeout(() => {
      setBeat(false);
    }, ACTION_BEAT_MS);

    return () => {
      window.clearTimeout(id);
    };
  }, [state]);

  return beat && state === 'recording';
};

// Clappy slates the take: through the big "3·2·1" he holds the clapper open, a beat on each number, and on
// "Action!" he slams it shut (silently: the mic is live by then). The dim behind the count lifts the moment
// the recording starts, so the person sees themself while the slam plays out, then the beat fades away.
// The number is keyed so each tick re-triggers its pop-in, reading as a distinct beat.
const CountdownOverlay = ({ value, action }: { value: number | null; action: boolean }) => {
  const { t } = useTranslation('media');
  const reduced = useReducedMotion() ?? false;

  if (value === null && !action) return null;

  const counting = value !== null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] transition-opacity duration-150 ease-out motion-reduce:transition-none"
        style={{ opacity: counting ? 1 : 0 }}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {counting ? t('camera.recordingIn', { value }) : t('camera.action')}
      </span>
      <motion.div
        aria-hidden="true"
        className="relative flex flex-col items-center text-center"
        animate={{ opacity: counting || reduced ? 1 : [1, 1, 0] }}
        transition={counting || reduced ? { duration: 0 } : { duration: ACTION_BEAT_MS / 1000, times: [0, 0.75, 1] }}
      >
        <ClappyCountdown value={value} size={112} />
        <CountdownCopy value={value} counting={counting} t={t} />
      </motion.div>
    </div>
  );
};

// Pulsing inset ring + "wrap up" badge shown during the last seconds of the target duration.
const EndWarningOverlay = () => {
  const { t } = useTranslation('media');

  return (
    <div className="pointer-events-none absolute inset-0 z-20 fade-in" role="status" aria-live="polite">
      <div className="absolute inset-0 animate-pulse ring-4 ring-inset ring-[var(--color-error)]" />
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-error)] text-white shadow-lg shadow-black/40">
        <TimerReset className="w-4 h-4" />
        <span className="text-sm font-bold tabular-nums">{t('camera.timesUp')}</span>
      </div>
    </div>
  );
};

// Muted "what to film" caption for the author's framing instructions, floated above the record control
// so it never sits under the button. Shown only before capture (idle/countdown), gone once recording starts.
const RecordingHint = ({ text }: { text: string }) => (
  <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center px-4 fade-in">
    <p className="max-w-md rounded-2xl bg-black/55 px-4 py-2 text-center text-sm font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-sm text-balance">
      {text}
    </p>
  </div>
);

interface StageOverlaysProps {
  state: CaptureState;
  countdownValue: number | null;
  // The "Action!" beat that follows a countdown into the recording (useActionBeat).
  actionBeat: boolean;
  endingSoon: boolean;
  framingGuide?: FramingGuideConfig;
  description?: string;
}

// The stacked live-preview overlays. The "what to film" hint only guides framing before capture, so it
// clears once recording starts — recording shows just the live feed and the record control (plus the
// end-warning beat near the duration cap, and the countdown on top before that).
const StageOverlays = ({
  state,
  countdownValue,
  actionBeat,
  endingSoon,
  framingGuide,
  description,
}: StageOverlaysProps) => {
  const framingPhase = state === 'idle' || state === 'countdown';

  return (
    <>
      {framingGuide && state !== 'preview' && (
        <FramingGuideOverlay guide={framingGuide} recording={state === 'recording'} />
      )}
      {description && framingPhase && <RecordingHint text={description} />}
      {endingSoon && <EndWarningOverlay />}
      {(state === 'countdown' || actionBeat) && (
        <CountdownOverlay value={state === 'countdown' ? countdownValue : null} action={actionBeat} />
      )}
    </>
  );
};

// The camera frame shape per orientation: portrait a centered 9:16 box, square a centered 1:1 box (both
// height-driven from `sm` up), landscape fills the whole stage. The recorder crops to the same aspect
// from the feed regardless, so the saved clip is unaffected.
const frameClassFor = (orientation: CaptureOrientation): string => {
  if (orientation === 'portrait') {
    return 'relative h-full w-full overflow-hidden sm:mx-auto sm:w-auto sm:max-w-full sm:aspect-[9/16]';
  }

  if (orientation === 'square') {
    return 'relative h-full w-full overflow-hidden sm:mx-auto sm:w-auto sm:max-w-full sm:aspect-square';
  }

  return 'relative w-full h-full';
};

// ── Controls ──────────────────────────────────────────────────────────────────

interface ControlsProps {
  state: CaptureState;
  mode: CaptureMode;
  onStart: () => void;
  onStop: () => void;
  onConfirm: () => void;
  onRetake: () => void;
}

const PreviewControls = ({ onConfirm, onRetake }: Pick<ControlsProps, 'onConfirm' | 'onRetake'>) => {
  const { t } = useTranslation('media');

  // Stacked on phones with the confirm at the bottom, nearest the thumb; side-by-side from `sm`.
  // Side-by-side at every width overflowed the viewport as soon as a locale spelled these out —
  // French's "Utiliser cette vidéo" beside "Refaire une prise" runs well past a 390px screen.
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-stretch gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center sm:gap-4">
      <Button onClick={onRetake} variant="secondary" size="lg" className="w-full min-w-0 sm:w-auto">
        <RotateCcw /> <span className="truncate">{t('camera.retake')}</span>
      </Button>
      <Button onClick={onConfirm} size="lg" className="w-full min-w-0 sm:w-auto">
        <Check /> <span className="truncate">{t('camera.useVideo')}</span>
      </Button>
    </div>
  );
};

function recordButtonLabel(state: CaptureState, t: TFunction<'media'>): string {
  if (state === 'countdown') return t('camera.cancelCountdown');

  if (state === 'recording') return t('camera.stopRecording');

  return t('camera.startRecording');
}

const RecordControls = ({ state, onStart, onStop }: Pick<ControlsProps, 'state' | 'onStart' | 'onStop'>) => {
  const { t } = useTranslation('media');
  const active = state === 'recording' || state === 'countdown';

  return (
    <div className="flex items-center justify-center">
      <button
        onClick={active ? onStop : onStart}
        disabled={state === 'loading'}
        aria-label={recordButtonLabel(state, t)}
        className={clsx(
          'tap relative grid place-items-center w-[4.5rem] h-[4.5rem] rounded-full border-4 border-foreground/80 transition-all duration-300 ease-[var(--ease-spring)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
          state === 'loading'
            ? 'opacity-50'
            : 'hover:border-white hover:shadow-[0_0_24px_-4px_oklch(0.643_0.215_28.8/0.6)] active:scale-90'
        )}
      >
        <span
          className={clsx(
            'bg-[var(--color-error)] transition-all duration-300 ease-[var(--ease-spring)]',
            active ? 'w-7 h-7 rounded-md' : 'w-14 h-14 rounded-full'
          )}
        />
      </button>
    </div>
  );
};

const UploadControls = ({ onOpen, fileName }: { onOpen: () => void; fileName?: string }) => {
  const { t } = useTranslation('media');

  return (
    <div className="flex items-center justify-center gap-4">
      <Button onClick={onOpen} size="lg">
        {t('upload.pickFile')}
      </Button>
      {fileName && <p className="text-white/80 text-sm truncate max-w-xs">{fileName}</p>}
    </div>
  );
};

const CameraControls = ({ state, mode, onStart, onStop, onConfirm, onRetake }: ControlsProps) => {
  if (state === 'error') return null;

  if (state === 'preview') return <PreviewControls onConfirm={onConfirm} onRetake={onRetake} />;

  if (mode === 'upload') return null;

  return <RecordControls state={state} onStart={onStart} onStop={onStop} />;
};

interface BackgroundStageProps {
  state: CaptureState;
  mode: CaptureMode;
  error: string;
  previewStream: MediaStream | null;
  previewUrl: string | null;
  orientation: CaptureOrientation;
  framingGuide?: FramingGuideConfig;
  description?: string;
  onRetry: () => void;
  onFileSelect: () => void;
  fileName?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  countdownValue: number | null;
  actionBeat: boolean;
  endingSoon: boolean;
}

function BackgroundStage({
  state,
  mode,
  error,
  previewStream,
  previewUrl,
  orientation,
  framingGuide,
  description,
  onRetry,
  onFileSelect,
  fileName,
  videoRef,
  countdownValue,
  actionBeat,
  endingSoon,
}: BackgroundStageProps) {
  const { t } = useTranslation('media');

  if (state === 'error') {
    return <CameraErrorView error={error} onRetry={onRetry} />;
  }

  if (mode === 'upload') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 w-full h-full">
        <UploadControls onOpen={onFileSelect} fileName={fileName} />
      </div>
    );
  }

  if (mode === 'screen') {
    return <ScreenPreview stream={previewStream} />;
  }

  const facingMode = mode === 'front' ? 'user' : 'environment';
  const frameClass = frameClassFor(orientation);

  return (
    <>
      <div className={frameClass}>
        {/* Live preview (hidden while reviewing the recording) */}
        <video
          ref={videoRef}
          aria-label={t('camera.livePreviewAria')}
          playsInline
          autoPlay
          muted
          className={clsx(
            'w-full h-full object-cover transition-opacity duration-300',
            facingMode === 'user' && '-scale-x-100',
            state === 'preview' ? 'opacity-0 absolute' : 'opacity-100'
          )}
        />

        {/* Review the recorded clip in the app's custom player (not the browser's default controls).
            The player fills the stage minus the floating chrome (top bar / retake+confirm), so a
            portrait take is shown as large as the frame allows instead of pillar-boxed in the middle
            of a mostly-empty black screen. The bottom inset is deeper on phones, where the two
            actions stack. */}
        {state === 'preview' && previewUrl && (
          <div className="absolute inset-0 flex items-center justify-center bg-black px-3 pb-[11.5rem] pt-20 sm:px-4 sm:pb-32 sm:pt-24">
            <div className="h-full w-full max-w-[min(100%,26rem)]">
              <VideoPreview url={previewUrl} autoPlay loop muted fill label={null} />
            </div>
          </div>
        )}

        <StageOverlays
          state={state}
          countdownValue={countdownValue}
          actionBeat={actionBeat}
          endingSoon={endingSoon}
          framingGuide={framingGuide}
          description={description}
        />
      </div>

      {state === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-foreground/80">
          <Loader2 className="w-8 h-8 animate-spin motion-reduce:animate-none" />
          <p className="text-sm">{t('camera.starting')}</p>
        </div>
      )}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export const CameraCapture = ({
  onCapture,
  onClose,
  countdownSeconds,
  maxDurationSeconds,
  framingGuide,
  description,
  orientation = 'landscape',
  defaultCaptureMode,
  allowedCaptureModes,
}: CameraCaptureProps) => {
  const session = useCaptureSession({
    defaultMode: defaultCaptureMode ?? 'front',
    allowedModes: allowedCaptureModes ?? ['front', 'back', 'screen', 'upload'],
    countdown: countdownSeconds,
    maxDuration: maxDurationSeconds,
    orientation,
  });

  const actionBeat = useActionBeat(session.state);

  // Keep a stable ref so confirming doesn't depend on the parent re-creating onCapture each render.
  const onCaptureRef = useRef(onCapture);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCaptureRef.current = onCapture;
    onCloseRef.current = onClose;
  });

  // "Use this video": confirm finalizes the capture, which populates `session.result`. For camera modes
  // the result only appears AFTER confirm (the recorded blob lives in `session.previewUrl` until then);
  // for screen/upload it's already there. So flag the intent, run confirm, and deliver the file to the
  // parent + close once the result lands. Delivery happens on explicit confirm only, so "Retake"
  // discards the take cleanly.
  const [confirmRequested, setConfirmRequested] = useState(false);
  const deliveredResultRef = useRef<File | null>(null);
  const handleConfirm = () => {
    setConfirmRequested(true);
    session.confirm();
  };
  useEffect(() => {
    if (!confirmRequested || !session.result || deliveredResultRef.current === session.result) return () => {};

    const result = session.result;
    deliveredResultRef.current = result;
    const timer = window.setTimeout(() => {
      onCaptureRef.current(result);
      onCloseRef.current();
      setConfirmRequested(false);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [confirmRequested, session.result]);

  return createPortal(
    // Fullscreen camera: the stage fills the whole viewport edge-to-edge; the top bar and record
    // controls float on top with gradient scrims for legibility (native-camera-app style).
    <div className="dark fixed inset-0 z-[60] bg-black fade-in">
      {/* Background stage */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <BackgroundStage
          state={session.state}
          mode={session.mode}
          error={session.error}
          previewStream={session.previewStream}
          previewUrl={session.previewUrl}
          orientation={orientation}
          framingGuide={framingGuide}
          description={description}
          onRetry={session.start}
          onFileSelect={session.openFilePicker}
          fileName={session.result?.name}
          videoRef={session.videoRef}
          countdownValue={session.countdownValue}
          actionBeat={actionBeat}
          endingSoon={session.endingSoon}
        />
      </div>

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 z-20 bg-linear-to-b from-black/55 to-transparent pb-8">
        <CameraTopBar
          state={session.state}
          mode={session.mode}
          elapsed={session.elapsed}
          onCancel={onClose}
          onSwitchCamera={() => {
            const nextMode = session.mode === 'front' ? 'back' : 'front';
            session.setMode(nextMode);
          }}
        />

        {/* Mode tab bar — only before capture starts; hidden once recording/countdown/review begins. */}
        {(session.state === 'idle' || session.state === 'loading') && (
          <div className="flex justify-center px-4 pb-2">
            <CaptureModeBar modes={session.allowedModes} active={session.mode} onChange={session.setMode} />
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-black/55 to-transparent pt-8 safe-b">
        <div className="px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
          <CameraControls
            state={session.state}
            mode={session.mode}
            onStart={session.start}
            onStop={session.stop}
            onConfirm={handleConfirm}
            onRetake={session.retake}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};
