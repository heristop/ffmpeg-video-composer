import { useCallback, useRef, type MouseEvent, type RefObject } from 'react';
import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { markSoundFound, readSound, tellVideo } from '@/lib/landing-sound';
import { FilmScreen, FilmStage, SoundControl, type FilmShape } from '@/presentation/components/film-frame';
import { EmbedDialog, type PlayerEmbed } from '@/presentation/components/player/embed-dialog';
import { PlayerOverlays, PlayerTransportBar } from '@/presentation/components/player/player-chrome';
import { useMediaState, type MediaState } from '@/presentation/components/player/use-media-state';
import { useFullscreen, usePlaybackRate } from '@/presentation/components/player/use-player';
import { usePlayerUi, type PlayerUi } from '@/presentation/components/player/use-player-chrome';
import { useFilmCaptions, useFilmVisibility } from './use-film-captions';
import { useFilmPlayer } from './use-film-player';
import type { FilmAsset } from './films';

export interface FilmPlayerLabels {
  play: string;
  pause: string;
  captions?: string;
  loading?: string;
  error?: string;
  retry?: string;
}

type FilmSources = Pick<FilmAsset, 'mp4' | 'poster'> & Partial<Pick<FilmAsset, 'captions'>> & { webm?: string };

interface FilmPlayerProps {
  /** The film: an MP4 (and a smaller WebM tried first, if any), its poster and its captions. */
  film: FilmSources;
  /** Accessible name of the film. */
  title: string;
  /** The frame's label pill, e.g. "The film · 1:18". */
  badge?: string;
  /** Label of the captions track, and its language. */
  captionsLabel?: string;
  captionsLang?: string;
  labels: FilmPlayerLabels;
  className?: string;
  /** Landing films play on view; showcase samples wait for a visitor request. */
  playback?: 'ambient' | 'requested';
  startRequested?: boolean;
  /** Loop even with the sound on (the effects reel); a film otherwise loops only while muted. */
  loop?: boolean;
  /** The film's frame: landscape by default, portrait or square for a sample made that way. */
  shape?: FilmShape;
  /** A frame that stays put, without the scroll reveal and the glow: a film inside a dialog. */
  still?: boolean;
  /** Set aside by the page (a dialog over it, or its own dialog closing): it pauses until it isn't. */
  suspended?: boolean;
  /** Offer the embed code: every film here has a public address. */
  embed?: PlayerEmbed;
}

// Nothing streams before the frame nears the viewport, even where the element already exists (reduced motion).
const preload = (playback: 'ambient' | 'requested', near: boolean): 'metadata' | 'none' =>
  playback === 'ambient' && near ? 'metadata' : 'none';

// On the landing's sound from the instant it mounts — muted, unless the visitor already turned it on — before the
// browser weighs autoplay, so the in-view play() goes through. The same state the sound hook applies after every
// render, so however React orders the two (StrictMode re-attaches refs after effects), they agree.
const onTheLandingSound = (node: HTMLVideoElement) => {
  const { enabled, volume } = readSound();

  tellVideo(node, !enabled, volume);
  node.setAttribute('muted', '');
};

function FilmVideo({
  film,
  videoRef,
  props,
  loop,
  preloadMode,
  onClick,
  onDoubleClick,
  onEnded,
}: {
  film: FilmSources;
  videoRef: (node: HTMLVideoElement | null) => void;
  props: Pick<FilmPlayerProps, 'title' | 'captionsLang' | 'captionsLabel'>;
  loop: boolean;
  preloadMode: 'metadata' | 'none';
  onClick: () => void;
  onDoubleClick: () => void;
  onEnded: () => void;
}) {
  return (
    <video
      ref={videoRef}
      className="absolute inset-0 size-full object-cover"
      poster={film.poster}
      loop={loop}
      playsInline
      preload={preloadMode}
      aria-label={props.title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onEnded={onEnded}
    >
      {film.webm && <source src={film.webm} type="video/webm" />}
      <source src={film.mp4} type="video/mp4" />
      {film.captions && (
        <track kind="captions" src={film.captions} srcLang={props.captionsLang} label={props.captionsLabel} default />
      )}
    </video>
  );
}

// The narration's captions, over the screen's foot; they rise clear of the controls while those show.
function FilmCue({ cue }: { cue: string }) {
  return (
    <p
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6 transition-transform duration-200 ease-[var(--ease-smooth)] group-data-[chrome=shown]/player:-translate-y-16"
    >
      <span className="max-w-3xl rounded-lg bg-player-ink/65 px-3 py-1.5 text-center text-sm font-medium leading-snug text-balance text-player-fg backdrop-blur-sm sm:text-base">
        {cue}
      </span>
    </p>
  );
}

// The shared stage refs: the scroll observers want the stage, the player wants the frame.
function useStageRef() {
  const [loadRef, shouldLoad] = useInView({ rootMargin: '300px' });
  const [playRef, inView] = useInView({ once: false, threshold: 0.35, rootMargin: '0px' });
  const setStageRef = useCallback(
    (node: HTMLDivElement | null) => {
      loadRef.current = node;
      playRef.current = node;
    },
    [loadRef, playRef]
  );

  return { setStageRef, shouldLoad, inView };
}

function useVideoElement(videoRef: RefObject<HTMLVideoElement | null>) {
  return useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;

      if (node) onTheLandingSound(node);
    },
    [videoRef]
  );
}

type FilmControls = ReturnType<typeof useFilmPlayer>;

// Any press in the bar tells the landing's sound that the visitor has found the frame's controls, so no frame hints
// at the sound button again.
const noticeTheBar = (event: MouseEvent<HTMLElement>) => {
  if (event.target instanceof Element && event.target.closest('.film-bar')) markSoundFound();
};

// The captions toggle, where the film has captions and a label for the button.
function captionsToggleFor(
  props: FilmPlayerProps,
  on: boolean,
  setCaptions: (update: (shown: boolean) => boolean) => void
): { on: boolean; onToggle: () => void } | undefined {
  const onToggle = () => {
    setCaptions((shown) => !shown);
  };

  return props.film.captions && props.labels.captions ? { on, onToggle } : undefined;
}

function FilmBar({
  title,
  labels,
  media,
  player,
  speed,
  captions,
  embeddable,
  fullscreen,
  ui,
  seekTo,
}: {
  title: string;
  labels: FilmPlayerLabels;
  media: MediaState;
  player: FilmControls;
  speed: { rate: number; setRate: (rate: number) => void };
  captions?: { on: boolean; onToggle: () => void };
  embeddable: boolean;
  fullscreen: ReturnType<typeof useFullscreen>;
  ui: PlayerUi;
  seekTo: (seconds: number) => void;
}) {
  return (
    <PlayerTransportBar
      label={title}
      className="film-bar bg-linear-to-t from-player-ink/85 via-player-ink/50 to-transparent pt-6"
      media={media}
      playLabels={{ play: media.failed ? (labels.retry ?? labels.play) : labels.play, pause: labels.pause }}
      onToggle={player.togglePlay}
      onSeek={seekTo}
      onScrub={ui.setScrubbing}
      sound={
        <SoundControl
          muted={player.muted}
          volume={player.volume}
          playing={!media.paused}
          onToggle={player.sound}
          onVolume={player.level}
        />
      }
      rate={speed.rate}
      onRate={speed.setRate}
      captions={captions}
      onEmbed={embeddable ? ui.openEmbed : undefined}
      fullscreen={{ active: fullscreen.active, onToggle: fullscreen.toggle }}
      portal={fullscreen.element}
      onMenuOpenChange={ui.setMenuOpen}
      timeClassName={captions ? '@max-[26rem]/player:hidden' : '@max-[21rem]/player:hidden'}
    />
  );
}

// What plays on the screen: the poster until the film mounts, then the film, its overlays and its captions.
function FilmMedia({
  props,
  mounted,
  shouldLoad,
  setVideoEl,
  media,
  player,
  ui,
  fullscreen,
  cue,
}: {
  props: FilmPlayerProps;
  mounted: boolean;
  shouldLoad: boolean;
  setVideoEl: (node: HTMLVideoElement | null) => void;
  media: MediaState;
  player: FilmControls;
  ui: PlayerUi;
  fullscreen: ReturnType<typeof useFullscreen>;
  /** The caption on screen now, if captions are on. */
  cue: string;
}) {
  const playback = props.playback ?? 'ambient';

  return (
    <>
      {!mounted && (
        <img
          src={props.film.poster}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {mounted && (
        <FilmVideo
          film={props.film}
          videoRef={setVideoEl}
          props={props}
          loop={props.loop === true || (playback === 'ambient' && player.muted)}
          preloadMode={preload(playback, shouldLoad)}
          onClick={ui.surfaceClick(player.togglePlay)}
          onDoubleClick={fullscreen.toggle}
          onEnded={player.ended}
        />
      )}
      <PlayerOverlays
        media={media}
        waitingForVisitor={player.held}
        playLabel={props.labels.play}
        onToggle={player.togglePlay}
        onRetry={player.togglePlay}
        statusLabels={props.labels}
      />
      {cue && <FilmCue cue={cue} />}
    </>
  );
}

// A film in the page's one video frame (film-frame.tsx), with the LeClap player's controls: it loads as it nears the
// viewport, plays while on screen and rests off-screen, with the landing's one sound (use-film-player.ts): muted
// until the visitor turns it on, here or anywhere else on the page, its captions carrying the narration meanwhile.
// A visitor's pause sticks. The bar seeks, changes speed, toggles captions, offers the embed code and goes
// fullscreen; the frame answers the player's keys. Every control exists before the film does, so a keyboard visitor
// tabbing down the page lands on them (focusing one scrolls the frame near, and the film mounts).
export const FilmPlayer = (props: FilmPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { setStageRef, shouldLoad, inView } = useStageRef();
  const mounted = shouldLoad || reduced;
  const media = useMediaState(videoRef, mounted);
  const startRequested = props.startRequested === true;
  const policy = { playback: props.playback ?? 'ambient', startRequested, inView, reduced, shouldLoad };
  const player = useFilmPlayer(videoRef, { ...policy, suspended: props.suspended === true }, media);
  const speed = usePlaybackRate(videoRef);
  const fullscreen = useFullscreen(frameRef, videoRef);
  const { captions, setCaptions, cue } = useFilmCaptions(videoRef, mounted);
  useFilmVisibility(videoRef, reduced, startRequested);
  const setVideoEl = useVideoElement(videoRef);
  const captionsToggle = captionsToggleFor(props, captions, setCaptions);
  const seekTo = (seconds: number) => {
    if (videoRef.current && media.duration > 0) videoRef.current.currentTime = seconds;
  };
  const ui = usePlayerUi({
    title: props.title,
    media,
    fullscreen,
    handlers: {
      toggle: player.togglePlay,
      seekTo,
      volumeBy: player.volumeBy,
      mute: player.sound,
      fullscreen: fullscreen.toggle,
      captions: captionsToggle?.onToggle,
      rate: speed.step,
    },
  });

  return (
    <FilmStage frameRef={setStageRef} className={props.className} still={props.still}>
      <FilmScreen
        shape={props.shape}
        badge={props.badge}
        paused={media.paused}
        frameRef={frameRef}
        frameProps={{
          ...ui.frameProps,
          className: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
          onClickCapture: noticeTheBar,
        }}
        bar={
          <FilmBar
            title={props.title}
            labels={props.labels}
            media={media}
            player={player}
            speed={speed}
            captions={captionsToggle}
            embeddable={props.embed !== undefined}
            fullscreen={fullscreen}
            ui={ui}
            seekTo={seekTo}
          />
        }
      >
        <FilmMedia
          props={props}
          mounted={mounted}
          shouldLoad={shouldLoad}
          setVideoEl={setVideoEl}
          media={media}
          player={player}
          ui={ui}
          fullscreen={fullscreen}
          cue={captions ? cue : ''}
        />
      </FilmScreen>
      {props.embed && <EmbedDialog embed={props.embed} open={ui.embedOpen} onOpenChange={ui.setEmbedOpen} />}
    </FilmStage>
  );
};
