import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PlayerBar,
  PlayerCaptionsButton,
  PlayerCenterButton,
  PlayerFullscreenButton,
  PlayerMoreMenu,
  PlayerPlayButton,
  PlayerRateMenu,
  PlayerSeek,
  PlayerStatus,
  PlayerTime,
} from './player-controls';
import type { MediaState } from './use-media-state';

// The player's chrome, laid out once for every LeClap player: the transport bar (seek; play, sound and time on the
// left; speed, captions, more and fullscreen on the right) and the overlays (the centre button, loading, failure).
// Narrow frames shed the time, then the speed, then the more menu (container queries on the frame), never play,
// sound, seek or fullscreen.

export interface TransportBarProps {
  /** Names the control group: which video these controls drive. */
  label: string;
  className?: string;
  media: MediaState;
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
  /** Present where the video can be embedded. */
  onEmbed?: () => void;
  fullscreen: { active: boolean; onToggle: () => void };
  /** Where menus render: the frame while it is fullscreen. */
  portal?: HTMLElement | null;
  onMenuOpenChange: (open: boolean) => void;
  /** When the time readout gives way: a fuller bar (the films' sound hint, captions) sheds it on a wider frame. */
  timeClassName?: string;
}

export function PlayerTransportBar(props: TransportBarProps) {
  const { media, captions, onEmbed } = props;

  return (
    <PlayerBar
      label={props.label}
      className={props.className}
      seek={
        <PlayerSeek
          current={media.current}
          duration={media.duration}
          buffered={media.buffered}
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
          {onEmbed && (
            <div className="@max-[16rem]/player:hidden">
              <PlayerMoreMenu container={props.portal} onOpenChange={props.onMenuOpenChange} onEmbed={onEmbed} />
            </div>
          )}
          <PlayerFullscreenButton active={props.fullscreen.active} onToggle={props.fullscreen.onToggle} />
        </>
      }
    />
  );
}

/**
 * Over the screen: the big play button while the film waits for the visitor (the poster, or their own pause), a
 * spinner while it stalls, and what went wrong with a retry when it fails.
 */
export function PlayerOverlays({
  media,
  waitingForVisitor,
  playLabel,
  onToggle,
  onRetry,
  statusLabels,
}: {
  media: MediaState;
  /** The film is paused on purpose: the poster, or the visitor's pause. */
  waitingForVisitor: boolean;
  playLabel: string;
  onToggle: () => void;
  onRetry: () => void;
  statusLabels?: Partial<{ loading: string; error: string; retry: string }>;
}) {
  const { t } = useTranslation('player');
  const showCenter = waitingForVisitor && media.paused && !media.failed && !media.waiting;

  return (
    <>
      {showCenter && <PlayerCenterButton label={playLabel} onToggle={onToggle} />}
      <PlayerStatus
        waiting={media.waiting}
        failed={media.failed}
        labels={{
          loading: statusLabels?.loading ?? t('loading'),
          error: statusLabels?.error ?? t('error'),
          retry: statusLabels?.retry ?? t('retry'),
        }}
        onRetry={onRetry}
      />
    </>
  );
}
