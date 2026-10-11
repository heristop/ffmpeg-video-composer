import { useRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { PlayerOverlays, PlayerTransportBar } from './player-chrome';
import { PlayerVolume } from './player-controls';
import { sceneShares } from './timeline.logic';
import { usePip } from './use-pip';
import { useMediaState } from './use-media-state';
import { useFullscreen, usePlaybackRate, useTransport, useVolume } from './use-player';
import { usePlayerUi } from './use-player-chrome';
import type { TemplateScenes } from './use-template-scenes';

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  /** The video's accessible name. */
  title: string;
  autoPlay?: boolean;
  loop?: boolean;
  /** Start muted: autoplay needs it, and a camera take plays back quietly. */
  muted?: boolean;
  /** A chip over the top-left corner once the video has started, fading with the controls. */
  label?: ReactNode;
  /** The title card's title, on the poster and in fullscreen. */
  cardTitle?: string;
  /** The template's scenes, to mark where each starts on the timeline. */
  scenes?: TemplateScenes | null;
  onMetadata?: (meta: { duration: number; width: number; height: number }) => void;
  /** The frame's classes: its size and shape come from where it sits. */
  className?: string;
  /** The clip's classes inside the frame. */
  videoClassName?: string;
}

function StartedLabel({ label }: { label?: ReactNode }) {
  if (!label) return null;

  return (
    <div className="player-fade pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-player-ink/60 px-3 py-1 text-xs font-medium text-player-fg/90 ring-1 ring-player-fg/15 backdrop-blur-sm">
      {label}
    </div>
  );
}

function PlayerVideo({
  props,
  videoRef,
  onClick,
  onDoubleClick,
}: {
  props: VideoPlayerProps;
  videoRef: RefObject<HTMLVideoElement | null>;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  return (
    <video
      ref={videoRef}
      src={props.src}
      poster={props.poster}
      aria-label={props.title}
      className={cn(
        'block object-contain group-data-[fullscreen]/player:h-full group-data-[fullscreen]/player:max-h-full group-data-[fullscreen]/player:w-full',
        props.videoClassName
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onLoadedMetadata={(event) => {
        const el = event.currentTarget;

        props.onMetadata?.({ duration: el.duration, width: el.videoWidth, height: el.videoHeight });
      }}
      controls={false}
      autoPlay={props.autoPlay}
      loop={props.loop}
      muted={props.muted}
      playsInline
      preload="metadata"
    />
  );
}

/**
 * The LeClap video player: the studio's render result, a test render and a camera take play here. The clip plays on
 * a click or a tap anywhere on it (a tap first brings hidden controls back), goes fullscreen on a double click, and
 * answers the player's keyboard (player.logic.ts) while focus is inside. Its controls (player-chrome.tsx) fade over a
 * playing clip once the pointer rests, and return on any move, touch or keyboard focus. It waits on a LeClap title
 * card, shows Clappy's loader while the clip stalls and his "cut" with a retry when it fails, and floats in a
 * picture-in-picture window where the browser can (use-pip.ts).
 */
export function VideoPlayer(props: VideoPlayerProps) {
  const { t } = useTranslation('player');
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const media = useMediaState(videoRef, props.src);
  const { rate, setRate, step } = usePlaybackRate(videoRef);
  const fullscreen = useFullscreen(frameRef, videoRef);
  const sound = useVolume(videoRef, props.muted === true);
  const transport = useTransport(videoRef, media);
  const pip = usePip(videoRef, props.src);
  const ui = usePlayerUi({
    title: props.title,
    media,
    fullscreen,
    handlers: {
      toggle: transport.toggle,
      seekTo: transport.seekTo,
      volumeBy: sound.volumeBy,
      mute: sound.toggleMute,
      fullscreen: fullscreen.toggle,
      rate: step,
      pip: pip.toggle,
    },
  });

  return (
    <div
      ref={frameRef}
      {...ui.frameProps}
      className={cn(
        'video-player group/player @container/player relative isolate overflow-hidden bg-player-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
        'data-[fullscreen]:flex data-[fullscreen]:h-full data-[fullscreen]:w-full data-[fullscreen]:items-center data-[fullscreen]:justify-center data-[fullscreen]:rounded-none',
        props.className
      )}
    >
      <PlayerVideo
        props={props}
        videoRef={videoRef}
        onClick={ui.surfaceClick(ui.toggle)}
        onDoubleClick={fullscreen.toggle}
      />
      <StartedLabel label={media.started && !fullscreen.active ? props.label : undefined} />
      <PlayerOverlays
        media={media}
        title={props.cardTitle}
        waitingForVisitor
        fullscreen={fullscreen.active}
        floating={pip.active}
        clap={ui.clap}
        playLabel={media.started ? t('play') : `${t('play')}: ${props.title}`}
        onToggle={ui.toggle}
        onRetry={transport.retry}
      />
      <div
        aria-hidden="true"
        className="player-fade pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-player-ink/85 via-player-ink/35 to-transparent"
      />
      <PlayerTransportBar
        label={t('controls')}
        className="player-fade absolute inset-x-0 bottom-0 z-10"
        media={media}
        videoRef={videoRef}
        markers={sceneShares(props.scenes, media.duration)}
        playLabels={{ play: t('play'), pause: t('pause') }}
        onToggle={ui.toggle}
        onSeek={transport.seekTo}
        onScrub={ui.setScrubbing}
        sound={
          <PlayerVolume
            muted={sound.muted}
            volume={sound.volume}
            onToggle={sound.toggleMute}
            onVolume={sound.setLevel}
          />
        }
        rate={rate}
        onRate={setRate}
        pip={pip}
        fullscreen={{ active: fullscreen.active, onToggle: fullscreen.toggle }}
        portal={fullscreen.element}
        onMenuOpenChange={ui.setMenuOpen}
        onHoverChange={ui.setOnControls}
      />
    </div>
  );
}
