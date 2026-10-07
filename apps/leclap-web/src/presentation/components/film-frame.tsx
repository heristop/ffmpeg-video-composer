import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useScrollReveal } from '@/hooks/use-scroll-reveal';
import { useSound } from '@/hooks/use-sound';
import { changedByVisitor, markSoundFound, setSoundEnabled, setSoundVolume, tellVideo } from '@/lib/landing-sound';
import { Volume2, VolumeX } from '@/presentation/components/icons';
import { perforationMaskStyle, perforationTileStyle } from '@/lib/film-strip';

// The home page's one frame for video: a clip-path-rounded screen with a glass label pill, sprocket-hole
// film edges and a glass control pill — shared by the in-browser render showcase and the films, so every
// video on the page reads as the same object, at the same size, arriving the same way, and speaks with
// the landing's one sound (lib/landing-sound.ts).

/** A beat after a frame's video is seen playing muted, its sound button arrives labelled... */
const HINT_DELAY_MS = 400;
/** ...and settles back into its icon after this long on screen. */
const HINT_MS = 6000;

/**
 * Where a frame sits on the page: a centred max-w-4xl column in perspective, a projector glow that fades in
 * behind it and slowly breathes, and the frame rising, fading and tilting up into place as it crosses the
 * viewport (useScrollReveal — a scrub, so it reverses on the way back up). Reduced motion leaves it in place.
 * The glow stays on the lavender→pink pair: the pastel yellow is kept for rarer moments, and over near-black
 * it only muddies to olive. `frameRef` reaches the frame, for the player's own in-view observers.
 */
export const FilmStage = ({
  frameRef,
  className,
  children,
}: {
  /** A callback ref: motion's own React types don't accept this package's `Ref`. */
  frameRef?: (node: HTMLDivElement | null) => void;
  className?: string;
  children: ReactNode;
}) => {
  const reduced = useReducedMotion();
  const scopeRef = useRef<HTMLDivElement>(null);
  const reveal = useScrollReveal(scopeRef);
  const [litRef, lit] = useInView({ threshold: 0.1 });
  const setScopeRef = useCallback(
    (node: HTMLDivElement | null) => {
      scopeRef.current = node;
      litRef.current = node;
    },
    [litRef]
  );

  return (
    <div ref={setScopeRef} className={cn('relative mx-auto w-full max-w-4xl perspective-[1400px]', className)}>
      <div
        aria-hidden="true"
        className={cn(
          'animate-aurora pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] blur-2xl transition-opacity duration-1000',
          'bg-linear-to-tr from-brand-500/20 via-brand-400/10 to-secondary-400/16',
          lit ? 'opacity-100' : 'opacity-0'
        )}
      />
      <motion.div
        ref={frameRef}
        className="relative rounded-xl shadow-xl ring-1 ring-foreground/10 sm:rounded-2xl sm:shadow-2xl"
        style={
          reduced ? undefined : { opacity: reveal.opacity, y: reveal.y, rotateX: reveal.rotateX, scale: reveal.scale }
        }
      >
        {children}
      </motion.div>
    </div>
  );
};

/**
 * The screen itself. The rounded clip is a clip-path because Chrome lets composited children (the <video>)
 * escape an overflow clip inside 3D-transformed ancestors, and the compositor always honours clip-path.
 * The control pill is a named group, so three frames' "Mute" buttons stay tell-apart for a screen reader,
 * and its buttons sit far enough apart that their 44 px hit areas meet without overlapping.
 */
export const FilmScreen = ({
  badge,
  control,
  controlLabel,
  paused = false,
  raised = false,
  children,
}: {
  /** The label pill, if any. */
  badge?: string;
  /** The corner control pill, if any. */
  control?: ReactNode;
  /** The accessible name of the control group: which video these controls drive. */
  controlLabel?: string;
  /** Whether the video is stopped: the sprocket holes stop with it, like film in a projector. */
  paused?: boolean;
  /** Lift the control pill clear of a seek bar along the bottom edge. */
  raised?: boolean;
  children: ReactNode;
}) => (
  <div className="relative aspect-video overflow-hidden rounded-[inherit] bg-black [clip-path:inset(0_round_0.75rem)] sm:[clip-path:inset(0_round_1rem)]">
    {children}

    {badge && (
      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/65 px-3 py-1 text-xs font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
        {badge}
      </span>
    )}

    <FilmEdge side="top" paused={paused} />
    <FilmEdge side="bottom" paused={paused} />

    {control && (
      <div
        role="group"
        aria-label={controlLabel}
        className={cn(
          'absolute right-3 flex items-center gap-3 rounded-full bg-black/60 px-1.5 py-1 ring-1 ring-white/15 backdrop-blur-sm',
          raised ? 'bottom-10' : 'bottom-3'
        )}
      >
        {control}
      </div>
    )}
  </div>
);

/**
 * Film-cell edges: sprocket holes drift along the frame's top or bottom (the footer motif), on a slim dark
 * gradient so the holes stay legible over bright video. The drifting span is one tile wider than the strip
 * and translates (compositor-only) while a static masked wrapper clips it and keeps the edge fade in place.
 */
const FilmEdge = ({ side, paused }: { side: 'top' | 'bottom'; paused: boolean }) => (
  <span
    aria-hidden="true"
    className={
      side === 'top'
        ? 'pointer-events-none absolute inset-x-0 top-0 h-3 bg-linear-to-b from-black/55 to-transparent'
        : 'pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-linear-to-t from-black/55 to-transparent'
    }
  >
    <span className="absolute inset-0 overflow-hidden" style={perforationMaskStyle}>
      <span
        className={cn(
          'animate-film-drift absolute inset-y-0 -left-7 right-0',
          paused && '[animation-play-state:paused]'
        )}
        style={{ ...perforationTileStyle, backgroundPosition: `left ${side}` }}
      />
    </span>
  </span>
);

/**
 * A round glass button for the control pill: 32 px visible, 44 px hit area. Keyboard focus takes the site-wide
 * brand outline (index.css) just inside the pill's edge, over a dark ring that fills the outline's offset, so
 * the indicator keeps its contrast over a white frame. No colour transition here: it would replace the `tap`
 * press spring's transform transition. Any press in the pill also tells the landing's sound that the visitor
 * has found the frame's controls, so no frame hints at the sound button again.
 */
export const FrameButton = ({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={() => {
      markSoundFound();
      onClick();
    }}
    aria-label={label}
    aria-pressed={pressed}
    className="tap relative grid h-8 w-8 place-items-center rounded-full text-white/85 before:absolute before:-inset-1.5 before:content-[''] hover:text-white focus-visible:ring-2 focus-visible:ring-black/80 [&_svg]:size-4"
  >
    {children}
  </button>
);

/**
 * A framed video's sound: the landing's one switch and level, so turning the sound on in any frame, or at the
 * hero, turns it on for every video, muting mutes them all, and unmuting lands at the shared level, never
 * silence. A browser may still refuse sound to a video that started on scroll rather than on a click (Safari
 * does, for a video the visitor never pressed): that one plays muted, and shows as muted, until its own button
 * is pressed (`refuse` records it, for playWithSound). The element follows the switch after every render, so
 * a video that mounts late picks it up too; `toggle` and `changeVolume` also set it inside the click itself,
 * the one moment every browser allows sound. Under reduced motion the native controls can move it as well,
 * and `adopt` carries their change to every other video — only theirs: every write here goes through
 * tellVideo, so the page's own changes, which `volumechange` reports late, are never mistaken for the visitor's.
 */
export const useFilmSound = (videoRef: RefObject<HTMLVideoElement | null>) => {
  const { enabled, volume } = useSound();
  const [refused, setRefused] = useState(false);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  const muted = !enabled || refused;

  // A switch that goes off and on again gives a refused video another chance at sound.
  if (enabled !== wasEnabled) {
    setWasEnabled(enabled);
    setRefused(false);
  }

  useEffect(() => {
    const el = videoRef.current;

    if (!el) return;

    tellVideo(el, muted, volume);
  });

  const unmute = (level: number) => {
    const el = videoRef.current;

    setRefused(false);

    if (!el) return;

    tellVideo(el, false, level);
  };

  const toggle = () => {
    if (!muted) {
      setSoundEnabled(false);

      return;
    }

    unmute(volume);
    setSoundEnabled(true);
  };

  const changeVolume = (next: number) => {
    if (next > 0) unmute(next);

    setSoundVolume(next);
  };

  const refuse = () => {
    setRefused(true);
  };

  const adopt = (el: HTMLVideoElement) => {
    if (!changedByVisitor(el)) return;

    if (el.muted || el.volume === 0) {
      setSoundEnabled(false);

      return;
    }

    setSoundVolume(el.volume);
  };

  return { muted, volume, toggle, changeVolume, refuse, adopt };
};

type HintPhase = 'waiting' | 'showing' | 'settled';

/**
 * Whether a frame's sound button is labelled right now. The label arrives a beat after the video is seen
 * playing muted, and only while the landing's sound is off and the visitor hasn't found it yet. It settles
 * for good after HINT_MS on screen, on any press in the pill, or once the sound is on anywhere. The countdown
 * runs only while the pill is on screen and its video playing, and holds while the pill is hovered or
 * focused, so the label never slips away from under a pointer or a keyboard focus.
 */
const useSoundHint = ({
  muted,
  playing,
  visible,
  held,
}: {
  muted: boolean;
  playing: boolean;
  visible: boolean;
  held: boolean;
}): boolean => {
  const { found } = useSound();
  const [phase, setPhase] = useState<HintPhase>('waiting');
  const remaining = useRef(HINT_MS);
  const live = muted && !found && playing && visible;

  useEffect(() => {
    if (phase !== 'waiting' || !live) return () => {};

    const id = globalThis.setTimeout(() => {
      setPhase('showing');
    }, HINT_DELAY_MS);

    return () => {
      globalThis.clearTimeout(id);
    };
  }, [phase, live]);

  useEffect(() => {
    if (phase !== 'showing' || !live || held) return () => {};

    const started = performance.now();
    const id = globalThis.setTimeout(() => {
      setPhase('settled');
    }, remaining.current);

    return () => {
      globalThis.clearTimeout(id);
      remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [phase, live, held]);

  return phase === 'showing' && muted && !found;
};

/**
 * The frame's sound button, first in the pill, with a volume slider that opens to its left on hover or
 * keyboard focus. Until the visitor has found the landing's sound, the button first arrives labelled: "Sound
 * on" unfolds leftward out of the muted speaker on a lit chip, with one soft ping, then settles back into the
 * icon (useSoundHint). It grows away from the pill's anchored corner, so the play and captions buttons never
 * move under a pointer, and it is the same button throughout, so keyboard focus survives the settle and its
 * name always carries the label a sighted visitor reads. The slider animates only its width, margins and
 * opacity, stays shut while the label shows, and speaks its level as a percentage rather than "0.7".
 */
export const SoundControl = ({
  muted,
  volume,
  playing,
  onToggle,
  onVolume,
}: {
  muted: boolean;
  volume: number;
  /** Whether the frame's video is playing: the label waits for it. */
  playing: boolean;
  onToggle: () => void;
  onVolume: (next: number) => void;
}) => {
  const { t } = useTranslation('home');
  const [viewRef, visible] = useInView({ once: false, threshold: 0.9, rootMargin: '0px' });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const labelled = useSoundHint({ muted, playing, visible, held: hovered || focused });

  return (
    <div
      ref={viewRef}
      className="group/vol flex flex-row-reverse items-center"
      onPointerEnter={() => {
        setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        aria-label={muted ? t('sound.on') : t('sound.off')}
        className="tap group/snd relative flex h-8 items-center rounded-full before:absolute before:-inset-1.5 before:content-[''] focus-visible:ring-2 focus-visible:ring-black/80"
      >
        {/* The lit chip the label arrives on; it fades back into the glass as the label settles. */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 rounded-full bg-brand-50 transition-[opacity,background-color] duration-300 group-hover/snd:bg-brand-100',
            labelled ? 'opacity-100' : 'opacity-0'
          )}
        />
        {labelled && (
          <span aria-hidden="true" className="sound-ping pointer-events-none absolute inset-0 rounded-full" />
        )}
        <span
          aria-hidden="true"
          className={cn(
            'relative grid ease-[var(--ease-out-expo)] transition-[grid-template-columns,opacity]',
            labelled ? 'grid-cols-[1fr] opacity-100 duration-500' : 'grid-cols-[0fr] opacity-0 duration-300'
          )}
        >
          <span className="min-w-0 overflow-hidden">
            <span className="block whitespace-nowrap pl-3.5 text-xs font-semibold tracking-[0.02em] text-brand-900 sm:text-sm">
              {t('sound.on')}
            </span>
          </span>
        </span>
        <span
          className={cn(
            'relative grid size-8 place-items-center transition-colors duration-300 [&_svg]:size-4',
            labelled ? 'text-brand-900' : 'text-white/85 group-hover/snd:text-white'
          )}
        >
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </span>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(event) => {
          onVolume(Number(event.target.value));
        }}
        aria-label={t('sound.volume')}
        aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
        className={cn(
          'h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 opacity-0 accent-white transition-[width,margin,opacity] duration-200 focus-visible:ml-1.5 focus-visible:mr-2 focus-visible:w-20 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-black/80',
          !labelled && 'group-hover/vol:ml-1.5 group-hover/vol:mr-2 group-hover/vol:w-20 group-hover/vol:opacity-100'
        )}
      />
    </div>
  );
};
