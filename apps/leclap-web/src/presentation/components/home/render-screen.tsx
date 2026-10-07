import { useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { Clappy, clappyHeight } from '@/presentation/components/clappy';
import { READY_FRAME, renderReadout, screenClappyFrame } from './render-screen.logic';
import { createFrameStore, useRenderScrub, type FrameStore, type ScreenLines } from './use-render-scrub';

// The landing phone's chapter 03, live: the app's render screen (apps/leclap-expo CompileProgressOverlay),
// scrubbed by the scroll (use-render-scrub.ts). It is laid out in the app capture's own units — the screen is
// 230 units wide, half the capture's 460 px — off a container query, so it scales with the phone without a
// measurement, and its box is the phone's screen, sized before anything loads: no layout shift. The colours
// are the app's monitor palette (theme.ts: monitorBackground, monitorText, monitorSecondary): a phone screen,
// dark on the light page too, like the clips around it. Decorative, as those clips are: the chapter's text
// says what it shows, so the whole screen stays hidden from assistive tech.

const RUN_START = screenClappyFrame({ run: 0, cheer: null, finish: null });

/** Clappy's width on the screen, in units: the capture's 200 px. */
const CLAPPY_UNITS = 100;
const CLAPPY_RATIO = CLAPPY_UNITS / clappyHeight(CLAPPY_UNITS);

const u = (value: number): string => `calc(var(--u) * ${value})`;

export interface RenderScreenProps {
  /** The pinned phone's chapter text, which the render follows; null follows the phone itself. */
  anchor: RefObject<HTMLElement | null> | null;
  /** The screen is the one showing and its phone is on screen. */
  live: boolean;
}

export const RenderScreen = ({ anchor, live }: RenderScreenProps) => {
  const { t, i18n } = useTranslation('home');
  const reduced = useReducedMotion();
  const screen = useRef<HTMLDivElement>(null);
  const [store] = useState(() => createFrameStore(RUN_START));
  // Reduced motion shows the finished render, still: nothing counts, nothing runs.
  const initial = renderReadout(reduced ? 1 : 0);
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' });
  const lines: ScreenLines = {
    percent: (value) => percent.format(value / 100),
    stage: (stage) => {
      if (stage === 'preparing') return t('mobile.screen.preparing');

      if (stage === 'ready') return t('mobile.screen.readyBody');

      return t(stage, { ns: 'process' });
    },
  };

  useRenderScrub({ screen, anchor, running: live && !reduced, lines, store, initial });

  return (
    <div
      ref={screen}
      aria-hidden="true"
      data-done={initial.done || undefined}
      className="group/render absolute inset-0 overflow-hidden bg-[#17142B] text-[#FCFBFF] [container-type:inline-size]"
    >
      <div
        className="absolute inset-0 flex flex-col items-center justify-center pb-[calc(var(--u)*8)] text-center [--u:calc(100cqw/230)]"
        style={{ paddingInline: u(18) }}
      >
        <ScreenClappy store={store} still={reduced} />
        <Swap
          className="mt-[calc(var(--u)*14)] font-display text-[length:calc(var(--u)*17)] font-medium leading-[1.2] tracking-[0.01em]"
          running={t('mobile.screen.title')}
          ready={t('mobile.screen.readyTitle')}
        />
        <p
          key={`percent-${initial.percent}-${i18n.language}`}
          data-scrub="percent"
          className="mt-[calc(var(--u)*6)] w-full font-display text-[length:calc(var(--u)*27)] font-bold leading-none tabular-nums"
        >
          {lines.percent(initial.percent)}
        </p>
        <div
          className="mt-[calc(var(--u)*12)] h-[calc(var(--u)*3)] w-full max-w-[calc(var(--u)*164)] overflow-hidden rounded-full bg-[#FCFBFF]/15"
          style={{ minHeight: 2 }}
        >
          <div
            data-scrub="bar"
            className="size-full origin-left rounded-full bg-brand-500 will-change-transform"
            style={{ transform: `scaleX(${initial.percent / 100})` }}
          />
        </div>
        <p
          key={`stage-${initial.stage}-${i18n.language}`}
          data-scrub="stage"
          className="mt-[calc(var(--u)*9)] line-clamp-2 min-h-[2.5em] w-full font-[system-ui,sans-serif] text-[length:calc(var(--u)*8.5)] leading-[1.25] text-[#C6C2DD]"
        >
          {lines.stage(initial.stage)}
        </p>
        <PrivacyLine label={t('mobile.screen.private')} />
        <Swap
          className="mt-[calc(var(--u)*8)] font-[system-ui,sans-serif] text-[length:calc(var(--u)*9)]"
          running={t('mobile.screen.cancel')}
          ready={t('mobile.screen.share')}
          pill
        />
        {/* The home indicator, as on the capture. */}
        <span
          className="absolute bottom-[calc(var(--u)*4)] left-1/2 h-[calc(var(--u)*2.5)] w-[calc(var(--u)*66)] -translate-x-1/2 rounded-full bg-[#FCFBFF]/85"
          style={{ minHeight: 2 }}
        />
      </div>
    </div>
  );
};

/**
 * Two labels in one cell, crossfading on the screen's `data-done`: the running one, then the ready one. Both
 * are laid out all along, so the swap never moves anything.
 */
const Swap = ({
  running,
  ready,
  pill = false,
  className,
}: {
  running: string;
  ready: string;
  pill?: boolean;
  className: string;
}) => {
  const layer = 'col-start-1 row-start-1 transition-opacity duration-300 ease-out motion-reduce:transition-none';
  const pillLayer = pill
    ? 'flex items-center justify-center rounded-[calc(var(--u)*6)] px-[calc(var(--u)*14)] h-[calc(var(--u)*27)]'
    : '';

  return (
    <div className={`grid max-w-full ${className}`}>
      <span className={`${layer} ${pillLayer} ${pill ? 'bg-[#FCFBFF]/10' : ''} group-data-[done]/render:opacity-0`}>
        {running}
      </span>
      <span
        className={`${layer} ${pillLayer} ${pill ? 'bg-brand-500 font-semibold' : ''} opacity-0 group-data-[done]/render:opacity-100`}
      >
        {ready}
      </span>
    </div>
  );
};

const PrivacyLine = ({ label }: { label: string }) => (
  <p className="mt-[calc(var(--u)*20)] flex items-center gap-[calc(var(--u)*5)] font-[system-ui,sans-serif] text-[length:calc(var(--u)*7.5)] text-[#C6C2DD]">
    <svg
      viewBox="0 0 24 24"
      className="h-[calc(var(--u)*9)] w-auto shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
    {label}
  </p>
);

/** Clappy on the screen: the scrubbed pose from the store, or the still ready pose under reduced motion. */
const ScreenClappy = ({ store, still }: { store: FrameStore; still: boolean }) => {
  const live = useSyncExternalStore(store.subscribe, store.get, store.get);
  const { pose, bob, lean, impact } = still ? READY_FRAME : live;
  const squash = bob * 0.03 + impact * 0.1;
  const body: CSSProperties = {
    transform: `translateY(${u(-bob * 8)}) rotate(${lean}deg) scale(${1 + squash}, ${1 - squash})`,
    transformOrigin: '50% 92%',
  };

  return (
    <div className="relative shrink-0" style={{ width: u(CLAPPY_UNITS), aspectRatio: CLAPPY_RATIO }}>
      {pose.stride !== undefined && <Dust stride={pose.stride} />}
      <div className="size-full" style={body}>
        <Clappy size={CLAPPY_UNITS} {...pose} followPointer={false} clapOnClick={false} className="size-full" />
      </div>
    </div>
  );
};

/**
 * Three puffs kicked up behind him, each drifting back and fading over one stride: the web runner's dust
 * (clappy-runner.tsx), moved by transform and opacity only.
 */
const Dust = ({ stride }: { stride: number }) => (
  <>
    {[0, 1, 2].map((index) => {
      const age = (stride + index / 3) % 1;

      return (
        <span
          key={index}
          className="absolute bottom-0 left-0 rounded-full bg-brand-300 blur-[1px]"
          style={{
            width: u(22),
            height: u(22),
            opacity: (1 - age) * 0.6,
            transform: `translate(${u(15 - age * 38)}, ${u(-(7 + age * 12))}) scale(${(10 + age * 16) / 26})`,
            transformOrigin: '0 100%',
          }}
        />
      );
    })}
  </>
);
