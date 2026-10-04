import { Loader2 } from 'lucide-react';
import { Captions, CaptionsOff, Pause, Play } from '@/presentation/components/icons';
import { FrameButton, SoundControl } from '@/presentation/components/film-frame';

export interface FilmPlayerLabels {
  play: string;
  pause: string;
  captions?: string;
  loading?: string;
  error?: string;
  retry?: string;
}

interface ControlsProps {
  labels: FilmPlayerLabels;
  paused: boolean;
  failed: boolean;
  muted: boolean;
  volume: number;
  captionsAvailable: boolean;
  captions: boolean;
  onPlay: () => void;
  onCaptions: () => void;
  onSound: () => void;
  onVolume: (next: number) => void;
}

export function FilmPlaybackControls(props: ControlsProps) {
  const playLabel = props.paused ? props.labels.play : props.labels.pause;

  return (
    <>
      <SoundControl
        muted={props.muted}
        volume={props.volume}
        playing={!props.paused}
        onToggle={props.onSound}
        onVolume={props.onVolume}
      />
      <FrameButton label={props.failed ? (props.labels.retry ?? props.labels.play) : playLabel} onClick={props.onPlay}>
        {props.paused ? <Play /> : <Pause />}
      </FrameButton>
      {props.captionsAvailable && props.labels.captions && (
        <FrameButton label={props.labels.captions} pressed={props.captions} onClick={props.onCaptions}>
          {props.captions ? <Captions /> : <CaptionsOff />}
        </FrameButton>
      )}
    </>
  );
}

export function FilmFeedback({
  waiting,
  failed,
  labels,
  cue,
  captions,
}: {
  waiting: boolean;
  failed: boolean;
  labels: FilmPlayerLabels;
  cue: string;
  captions: boolean;
}) {
  return (
    <>
      {waiting && !failed && labels.loading && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 grid place-content-center bg-black/30 text-white"
        >
          <Loader2 size={28} className="motion-safe:animate-spin" aria-hidden="true" />
          <span className="sr-only">{labels.loading}</span>
        </div>
      )}
      {failed && labels.error && (
        <p
          role="alert"
          className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-lg bg-black/80 p-4 text-center text-sm text-white"
        >
          {labels.error}
        </p>
      )}
      {captions && cue && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-6 sm:bottom-16"
        >
          <span className="max-w-3xl rounded-lg bg-black/60 px-3 py-1.5 text-center text-sm font-medium leading-snug text-balance text-white backdrop-blur-sm sm:text-base">
            {cue}
          </span>
        </p>
      )}
    </>
  );
}
