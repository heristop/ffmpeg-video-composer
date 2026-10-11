import type { ReactNode, RefObject } from 'react';
import { PlayerBrackets, PlayerClap, PlayerTitleCard, type CardMeta } from './player-card';
import {
  PlayerBar,
  PlayerCaptionsButton,
  PlayerCenterButton,
  PlayerFullscreenButton,
  PlayerPlayButton,
  PlayerRateMenu,
  PlayerTime,
} from './player-controls';
import { PlayerPipButton, PlayerPipCover } from './player-pip';
import { PlayerStatus } from './player-status';
import { PlayerTimeline } from './player-timeline';
import type { MediaState } from './use-media-state';
import type { PlayerPip } from './use-pip';

// The player's chrome, laid out once for every LeClap player: the transport bar (the film-strip timeline; play, sound
// and time on the left; speed, captions, picture-in-picture and fullscreen on the right) and the overlays (the title card and the
// monitor brackets on the poster and in fullscreen, the centre button, the clap, loading, failure). Narrow frames
// (mini mode) shed the time, then the speed, the frame preview, the perforations, the title
// and Clappy (container queries on the frame), never play, sound, seek or fullscreen.

export interface TransportBarProps {
  /** Names the control group: which video these controls drive. */
  label: string;
  className?: string;
  media: MediaState;
  /** The playing element, for the timeline's frame preview. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Where scenes start, as shares of the bar. */
  markers?: readonly number[];
  playLabels: { play: string; pause: string };
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onScrub: (scrubbing: boolean) => void;
  /** The sound control: the player's own, or the landing's (film-frame.tsx). */
  sound: ReactNode;
  rate: number;
  onRate: (rate: number) => void;
  /** Present where the video has captions. */
  captions?: { on: boolean; onToggle: () => void };
  /** Picture-in-Picture (use-pip.ts). */
  pip: PlayerPip;
  fullscreen: { active: boolean; onToggle: () => void };
  /** Where menus render: the frame while it is fullscreen. */
  portal?: HTMLElement | null;
  onMenuOpenChange: (open: boolean) => void;
  /** When the time readout gives way: a fuller bar (the films' sound hint, captions) sheds it on a wider frame. */
  timeClassName?: string;
}

export function PlayerTransportBar(props: TransportBarProps) {
  const { media, captions } = props;

  return (
    <PlayerBar
      label={props.label}
      className={props.className}
      seek={
        <PlayerTimeline
          media={media}
          videoRef={props.videoRef}
          markers={props.markers}
          onSeek={props.onSeek}
          onScrub={props.onScrub}
        />
      }
      start={
        <>
          <PlayerPlayButton paused={media.paused} labels={props.playLabels} onToggle={props.onToggle} />
          {props.sound}
          <PlayerTime
            current={media.current}
            duration={media.duration}
            className={props.timeClassName ?? '@max-[18rem]/player:hidden'}
          />
        </>
      }
      end={
        <>
          <div className="@max-[20rem]/player:hidden">
            <PlayerRateMenu
              rate={props.rate}
              onRate={props.onRate}
              container={props.portal}
              onOpenChange={props.onMenuOpenChange}
            />
          </div>
          {captions && <PlayerCaptionsButton on={captions.on} onToggle={captions.onToggle} />}
          <PlayerPipButton pip={props.pip} />
          <PlayerFullscreenButton active={props.fullscreen.active} onToggle={props.fullscreen.onToggle} />
        </>
      }
    />
  );
}

/** The poster's (and fullscreen's) LeClap cover: the title card and the monitor's brackets. */
function PlayerCover({
  media,
  title,
  meta,
  fullscreen,
}: {
  media: MediaState;
  title?: string;
  meta?: CardMeta;
  fullscreen: boolean;
}) {
  return (
    <>
      <PlayerTitleCard title={title} media={media} meta={meta} cinema={fullscreen} />
      <PlayerBrackets className={fullscreen ? 'player-fade inset-x-6 top-6 bottom-32' : undefined} />
    </>
  );
}

/** The clap as the visitor starts the film, and the cover that says it floats in its own window. */
function PlayerMoments({ clap, floating }: { clap: number; floating: boolean }) {
  return (
    <>
      {clap > 0 && <PlayerClap key={clap} />}
      {floating && <PlayerPipCover />}
    </>
  );
}

/**
 * Over the screen: the cover while the video waits on its poster (and, larger, in fullscreen), the centre call to
 * action while the visitor holds it paused, the clap when they start it, the loader while it stalls, and Clappy
 * calling "cut" with a retry when it fails.
 */
export function PlayerOverlays({
  media,
  title,
  meta,
  posterCard = true,
  waitingForVisitor,
  fullscreen,
  floating,
  clap,
  playLabel,
  onToggle,
  onRetry,
  statusLabels,
}: {
  media: MediaState;
  /** The title card's title. */
  title?: string;
  /** The card's shape and length before the video's metadata has loaded (a poster that preloads nothing). */
  meta?: CardMeta;
  /** Whether the poster wears the title card (a landing film's poster is designed already); fullscreen always does. */
  posterCard?: boolean;
  /** The film is paused on purpose: the poster, or the visitor's pause. */
  waitingForVisitor: boolean;
  fullscreen: boolean;
  /** The video floats in its picture-in-picture window. */
  floating: boolean;
  /** Bumped each time the visitor starts the film: it replays the clap. */
  clap: number;
  playLabel: string;
  onToggle: () => void;
  onRetry: () => void;
  statusLabels?: Partial<{ loading: string; error: string; retry: string }>;
}) {
  const ready = !media.failed && !media.waiting && !floating;
  const poster = posterCard && ready && media.paused && !media.started;

  return (
    <>
      {(poster || fullscreen) && (
        <PlayerCover media={media} title={title} meta={meta} fullscreen={fullscreen} />
      )}
      {waitingForVisitor && media.paused && ready && <PlayerCenterButton label={playLabel} onToggle={onToggle} />}
      <PlayerMoments clap={clap} floating={floating} />
      <PlayerStatus media={media} labels={statusLabels} onRetry={onRetry} />
    </>
  );
}
