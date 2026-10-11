import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { EmbedDialog, type PlayerEmbed } from './embed-dialog';
import { embedAvailable } from './embed.logic';
import type { PlayerCaptions, PlayerSource } from './embed-media';
import { PlayerOverlays, PlayerTransportBar } from './player-chrome';
import { PlayerVolume } from './player-controls';
import { useMediaState } from './use-media-state';
import { useFullscreen, usePlaybackRate, useTransport, useVolume } from './use-player';
import { usePlayerUi } from './use-player-chrome';

export interface VideoPlayerProps {
  /** One source, or several in order of preference (`sources`). */
  src?: string;
  sources?: PlayerSource[];
  poster?: string;
  /** The video's accessible name. */
  title: string;
  autoPlay?: boolean;
  loop?: boolean;
  /** Start muted: autoplay needs it, and a camera take plays back quietly. */
  muted?: boolean;
  captions?: PlayerCaptions;
  /** Offer the embed code: only for a video the site serves publicly (embed.logic.ts). */
  embed?: PlayerEmbed;
  /** Its shortcuts answer anywhere on the page, not only with focus inside it: the embed, where it is the page. */
  pageKeys?: boolean;
  /** A chip over the top-left corner, fading with the controls. */
  label?: ReactNode;
  /** An action over the top-right corner (the embed's link back), fading with the controls. */
  corner?: ReactNode;
  onMetadata?: (meta: { duration: number; width: number; height: number }) => void;
  /** The frame's classes: its size and shape come from where it sits. */
  className?: string;
  /** The clip's classes inside the frame. */
  videoClassName?: string;
}

/** The captions toggle, applied to the track: the browser draws the cues (styled in index.css). */
function useCaptionsTrack(videoRef: RefObject<HTMLVideoElement | null>, captions: PlayerCaptions | undefined) {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const track = videoRef.current?.textTracks[0];

    if (track) track.mode = on ? 'showing' : 'hidden';
  }, [videoRef, on, captions]);

  const onToggle = () => {
    setOn((shown) => !shown);
  };

  return captions ? { on, onToggle } : undefined;
}

/** The embed's keyboard: the player is the page, so its keys work before anything inside it has focus. */
function usePageKeys(enabled: boolean, onKey: (event: KeyboardEvent) => void) {
  useEffect(() => {
    if (!enabled) return () => {};

    const listener = (event: KeyboardEvent) => {
      if (event.target === document.body) onKey(event);
    };

    globalThis.addEventListener('keydown', listener);

    return () => {
      globalThis.removeEventListener('keydown', listener);
    };
  });
}

function Corners({ label, corner }: { label?: ReactNode; corner?: ReactNode }) {
  return (
    <>
      {label && (
        <div className="player-fade pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-player-ink/60 px-3 py-1 text-xs font-medium text-player-fg/90 ring-1 ring-player-fg/15 backdrop-blur-sm">
          {label}
        </div>
      )}
      {corner && <div className="player-fade absolute right-3 top-3 z-10">{corner}</div>}
    </>
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
    >
      {props.sources?.map((source) => (
        <source key={source.src} src={source.src} type={source.type} />
      ))}
      {props.captions && (
        <track
          kind="captions"
          src={props.captions.src}
          srcLang={props.captions.lang}
          label={props.captions.label}
          default
        />
      )}
    </video>
  );
}

/**
 * The LeClap video player: the render result, a test render, a camera take and the embed all play here. The clip
 * plays on a click or a tap anywhere on it (a tap first brings hidden controls back), goes fullscreen on a double
 * click, and answers the player's keyboard (player.logic.ts) while focus is inside. Its controls (player-chrome.tsx)
 * fade over a playing clip once the pointer rests, and return on any move, touch or keyboard focus. It shows a
 * spinner while the clip stalls and a retry when it fails. A local render (a blob: URL) never offers the embed code.
 */
export function VideoPlayer(props: VideoPlayerProps) {
  const { t } = useTranslation('player');
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const primary = props.src ?? props.sources?.[0]?.src;
  const media = useMediaState(videoRef, primary);
  const { rate, setRate, step } = usePlaybackRate(videoRef);
  const fullscreen = useFullscreen(frameRef, videoRef);
  const sound = useVolume(videoRef, props.muted === true);
  const transport = useTransport(videoRef, media);
  const captions = useCaptionsTrack(videoRef, props.captions);
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
      captions: captions?.onToggle,
      rate: step,
    },
  });
  usePageKeys(props.pageKeys === true, ui.onKey);
  const embed = props.embed && embedAvailable(primary, props.embed.ref) ? props.embed : undefined;

  return (
    <>
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
          onClick={ui.surfaceClick(transport.toggle)}
          onDoubleClick={fullscreen.toggle}
        />
        <Corners label={props.label} corner={props.corner} />
        <PlayerOverlays
          media={media}
          waitingForVisitor
          playLabel={media.started ? t('play') : `${t('play')}: ${props.title}`}
          onToggle={transport.toggle}
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
          playLabels={{ play: t('play'), pause: t('pause') }}
          onToggle={transport.toggle}
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
          captions={captions}
          onEmbed={embed && ui.openEmbed}
          fullscreen={{ active: fullscreen.active, onToggle: fullscreen.toggle }}
          portal={fullscreen.element}
          onMenuOpenChange={ui.setMenuOpen}
        />
      </div>
      {embed && <EmbedDialog embed={embed} open={ui.embedOpen} onOpenChange={ui.setEmbedOpen} />}
    </>
  );
}
