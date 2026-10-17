import { createElement, useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Hourglass } from 'lucide-react';
import { CheckCircle2, AlertCircle } from '@/presentation/components/icons';
import { ClockIcon } from '@/presentation/components/icons/clock';
import { CpuIcon } from '@/presentation/components/icons/cpu';
import { ShieldCheckIcon } from '@/presentation/components/icons/shield-check';
import clsx from 'clsx';
import { GradientMeter } from '@/presentation/components/kinetic';
import { ClappyRunner } from '@/presentation/components/clappy';
import { etaVisible, formatDuration, quipKey, remainingMs, stageKey } from './progress-display.logic';

interface ProcessingProgress {
  stage: string;
  percentage: number;
  currentStep: string;
  totalSteps: number;
  currentStepIndex: number;
  estimatedTimeRemaining?: number;
}

interface ProgressDisplayProps {
  progress: ProcessingProgress;
}

const getStageIcon = (stage: string, percentage: number) => {
  if (stage === 'Error') return AlertCircle;

  if (percentage >= 100) return CheckCircle2;

  return CpuIcon;
};

interface StepIndicatorProps {
  stepNumber: number;
  currentStepIndex: number;
}

// Angles (deg) for the one-shot success burst — an even ring of 6 dots.
const BURST_ANGLES = [0, 60, 120, 180, 240, 300];

// A radial pop of dots, mounted only for the moment a step completes. The
// caller re-mounts it via `key` so the animation restarts on each success.
const SuccessBurst = () => (
  <span aria-hidden className="pointer-events-none absolute inset-0">
    {BURST_ANGLES.map((angle, i) => (
      <span key={angle} className="absolute left-1/2 top-1/2 h-0 w-0" style={{ transform: `rotate(${angle}deg)` }}>
        <span
          className="dot-burst block h-1 w-1 -ml-0.5 -mt-0.5 rounded-full bg-success"
          style={{ animationDelay: `${i * 16}ms` }}
        />
      </span>
    ))}
  </span>
);

const StepIndicator = ({ stepNumber, currentStepIndex }: StepIndicatorProps) => {
  const isCompleted = stepNumber < currentStepIndex;
  const isCurrent = stepNumber === currentStepIndex;
  const isPending = stepNumber > currentStepIndex;

  // Fire the burst once, on the false→true completion edge — not on mount when a
  // step is already done, nor on unrelated re-renders. Each edge bumps the key so
  // the burst element re-mounts and replays.
  const [burstKey, setBurstKey] = useState(0);
  const wasCompleted = useRef(isCompleted);

  useEffect(() => {
    if (isCompleted && !wasCompleted.current) {
      setBurstKey((key) => key + 1);
    }

    wasCompleted.current = isCompleted;
  }, [isCompleted]);

  return (
    <div className="flex flex-col items-center space-y-2">
      <div className="relative">
        {/* The active step is marked by its gradient fill and ring, not by a loop: only two things
            move during a compile — Clappy running the bar (ambient "still working") and the burst a
            step fires when it actually completes (an event). Anything else read as flicker. */}
        <div
          className={clsx(
            'relative w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ease-[cubic-bezier(0.34,1.2,0.64,1)] border',
            isCompleted &&
              'bg-success border-success text-success-foreground scale-105 shadow-[0_0_10px_oklch(0.84_0.065_160/0.45)]',
            isCurrent && 'brand-gradient border-transparent text-white ring-4 ring-brand-500/25',
            isPending && 'bg-surface-2 border-foreground/15 text-gray-500'
          )}
        >
          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : stepNumber}
        </div>
        {burstKey > 0 && <SuccessBurst key={burstKey} />}
      </div>
      <div
        className={clsx(
          'w-2 h-1 rounded-full transition-all duration-300',
          isCompleted && 'bg-success',
          isCurrent && 'bg-brand-500',
          isPending && 'bg-foreground/15'
        )}
      />
    </div>
  );
};

interface MetricProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

const Metric = ({ icon: Icon, label, value }: MetricProps) => (
  <div className="min-w-0 text-center">
    <div className="mb-1 flex items-center justify-center gap-1 text-[0.7rem] text-gray-400 sm:text-sm">
      <Icon className="w-3.5 h-3.5 shrink-0 sm:w-4 sm:h-4" />
      <span className="truncate">{label}</span>
    </div>
    <p className="truncate text-sm font-semibold tabular-nums text-foreground sm:text-lg">{value}</p>
  </div>
);

interface PerformanceMetricsProps {
  percentage: number;
  elapsedMs: number;
  leftMs: number | undefined;
}

// Three distinct readouts: where it runs, how long it has taken, how long is left. The percentage is
// not one of them — the bar's own readout already says it — and the estimate holds on "Estimating…"
// until it stops being noise (etaVisible).
const PerformanceMetrics = ({ percentage, elapsedMs, leftMs }: PerformanceMetricsProps) => {
  const { t, i18n } = useTranslation('process');
  const done = percentage >= 100;
  const left = (): string => {
    if (done) return formatDuration(0, i18n.language);

    if (etaVisible(elapsedMs, percentage, leftMs)) {
      return t('progress.metrics.about', { time: formatDuration(leftMs ?? 0, i18n.language) });
    }

    return t('progress.metrics.estimating');
  };

  return (
    <div className="grid grid-cols-3 gap-2 rounded-xl border border-foreground/5 bg-surface/40 p-3 sm:gap-4 sm:p-4">
      <Metric icon={ShieldCheckIcon} label={t('progress.metrics.private')} value={t('progress.metrics.onDevice')} />
      <Metric icon={ClockIcon} label={t('progress.metrics.elapsed')} value={formatDuration(elapsedMs, i18n.language)} />
      <Metric icon={Hourglass} label={t('progress.metrics.left')} value={left()} />
    </div>
  );
};

interface ProgressHeaderProps {
  stage: string;
  percentage: number;
}

// The stage in the viewer's language (the engine names it in English). No "Step N of M" under it: the
// dots below march with the bar, not with the engine's stages (which sit on "rendering" for most of
// the run), so a step count here read "Rendering scenes · Step 1 of 7". This is the live region: it
// changes a handful of times per render, where the ticking clock and the quips below would have had a
// screen reader talking the whole way through.
const ProgressHeader = ({ stage, percentage }: ProgressHeaderProps) => {
  const { t } = useTranslation('process');
  const StageIcon = getStageIcon(stage, percentage);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="flex min-w-0 items-center gap-3">
      {/* The stage badge sits still — Clappy running the bar below already carries "working", and a
          second pulsing element here made the whole header feel like it was flickering. */}
      <div
        className={clsx(
          'shrink-0 rounded-lg p-2 transition-colors duration-300',
          percentage >= 100
            ? 'bg-success/15 text-success-foreground'
            : 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
        )}
      >
        {createElement(StageIcon as ComponentType<{ className?: string }>, { className: 'w-5 h-5' })}
      </div>
      <h3 className="min-w-0 truncate text-base font-semibold text-foreground sm:text-lg">{t(stageKey(stage))}</h3>
    </div>
  );
};

interface ProgressBarProps {
  percentage: number;
}

const ProgressBar = ({ percentage }: ProgressBarProps) => {
  const { t } = useTranslation('process');
  const done = percentage >= 100;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        {/* The creative kit's render quips, translated, one per band of the bar, so the line moves on as
            the render does. Flavour, not information: the stage above says what is happening. */}
        <span className="min-w-0 flex-1 truncate font-medium text-gray-300">
          {done ? t('progress.complete.title') : t(quipKey(percentage))}
        </span>
        {/* Tabular + a reserved min-width so the readout never reflows the step label as it climbs
            from one to three digits. */}
        <span
          className={clsx(
            'shrink-0 text-right font-semibold tabular-nums [min-width:3.25ch]',
            done ? 'text-success-foreground' : 'text-brand-700 dark:text-brand-300'
          )}
        >
          {Math.round(percentage)}%
        </span>
      </div>

      {/* The render bar reads in the shared GradientMeter family (lavender→pink), with Clappy running
          its lane: he keeps pace with the fill while the compile runs, and throws his arms up as it
          settles to success green on completion. */}
      <div>
        <ClappyRunner progress={percentage / 100} done={done} />
        <GradientMeter
          progress={percentage / 100}
          variant="bar"
          size={12}
          success={done}
          label={t('progress.bar.ariaLabel')}
        />
      </div>
    </div>
  );
};

export const ProgressDisplay = ({ progress }: ProgressDisplayProps) => {
  const { stage, percentage: rawPercentage, totalSteps, estimatedTimeRemaining } = progress;

  // The bar is the single source of truth. Keep it monotonic so a late segment resetting its raw
  // fraction can't rewind it; a fresh run (raw back near 0) drops the floor so the next compile starts over.
  const [maxPct, setMaxPct] = useState(0);
  const nextMaxPct = rawPercentage <= 1 ? rawPercentage : Math.max(maxPct, rawPercentage);

  if (nextMaxPct !== maxPct) setMaxPct(nextMaxPct);

  const percentage = Math.max(nextMaxPct, rawPercentage);

  // Derive the active dot from the bar so the dots march 1→N in lockstep with progress instead of
  // sitting on a hardcoded step; one past the last when complete so every dot reads done.
  const done = percentage >= 100;
  const activeStep = done
    ? totalSteps + 1
    : Math.min(totalSteps, Math.max(1, Math.ceil((percentage / 100) * totalSteps)));

  // Live elapsed time: the clock starts when this mounts (the compile is what mounts it) and freezes
  // at completion.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startTimer = window.setTimeout(() => {
      setStartedAt(Date.now());
    }, 0);

    return () => {
      window.clearTimeout(startTimer);
    };
  }, []);

  useEffect(() => {
    if (startedAt === null) return () => {};

    const tick = () => {
      setElapsedMs(Date.now() - startedAt);
    };

    tick();

    const id = done ? null : window.setInterval(tick, 500);

    return () => {
      if (id !== null) window.clearInterval(id);
    };
  }, [done, startedAt]);

  return (
    // The panel itself doesn't breathe — a looping opacity dip on this container fades its own text
    // for the length of the compile. Clappy, running the bar, carries liveness on his own.
    <div className="space-y-5 fade-in sm:space-y-6">
      <ProgressHeader stage={stage} percentage={percentage} />

      <ProgressBar percentage={percentage} />

      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3 sm:justify-between sm:gap-x-1">
        {Array.from({ length: totalSteps }, (_, index) => (
          <StepIndicator key={index + 1} stepNumber={index + 1} currentStepIndex={activeStep} />
        ))}
      </div>

      <PerformanceMetrics
        percentage={percentage}
        elapsedMs={elapsedMs}
        leftMs={remainingMs(elapsedMs, percentage, estimatedTimeRemaining)}
      />
    </div>
  );
};
