import { useState } from 'react';
import { Download } from '@/presentation/components/icons';
import { SparklesIcon } from '@/presentation/components/icons/sparkles';
import { PlayIcon } from '@/presentation/components/icons/play';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  ColorPicker,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/presentation/components/ui';
import { Seo } from '@/presentation/components/Seo';
import { VideoPreview } from '@/presentation/components/VideoPreview';
import { KineticHeading } from '@/presentation/components/kinetic';
import { Code, DocSection, DocSubsection, Eyebrow, Prose } from '@/presentation/components/doc/DocBlocks';
import { bezierPath, durationMs, parseCubicBezier, type Bezier } from './design-tokens.logic';

// The living reference for the tokens in index.css and the ui/ primitives. It shares the docs' page
// header, section headings and rhythm, so the two English-only reference surfaces read as one.

// ── Colour ────────────────────────────────────────────────────────────────────

interface Ramp {
  id: string;
  title: string;
  token: string;
  steps: readonly number[];
  // The brand anchor of the ramp and its reference hex, from DESIGN.md.
  anchor: { step: number; hex: string };
}

const RAMPS: readonly Ramp[] = [
  {
    id: 'colour-brand',
    title: 'Lavender — primary',
    token: 'brand',
    steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    anchor: { step: 500, hex: '#7C83FD' },
  },
  {
    id: 'colour-secondary',
    title: 'Rose — secondary',
    token: 'secondary',
    steps: [50, 100, 200, 300, 400, 500, 600, 700],
    anchor: { step: 500, hex: '#FF8AAE' },
  },
  {
    id: 'colour-accent',
    title: 'Pastel yellow — accent',
    token: 'accent',
    steps: [300, 400, 500, 600, 700],
    anchor: { step: 500, hex: '#FFF685' },
  },
];

const CANVAS_TOKENS = [
  'background',
  'surface',
  'surface-2',
  'surface-inset',
  'divider',
  'foreground',
  'muted-foreground',
] as const;
const STATUS_TOKENS = ['success', 'error', 'warning', 'info'] as const;

// Literal class names rather than `bg-${token}` or an inline var(): Tailwind only emits a theme
// variable that some source names in full, so a swatch assembled from a template string painted
// nothing for the steps no other screen happens to use (secondary-50…200, accent-300).
const SWATCH_BG: Partial<Record<string, string>> = {
  'brand-50': 'bg-brand-50',
  'brand-100': 'bg-brand-100',
  'brand-200': 'bg-brand-200',
  'brand-300': 'bg-brand-300',
  'brand-400': 'bg-brand-400',
  'brand-500': 'bg-brand-500',
  'brand-600': 'bg-brand-600',
  'brand-700': 'bg-brand-700',
  'brand-800': 'bg-brand-800',
  'brand-900': 'bg-brand-900',
  'secondary-50': 'bg-secondary-50',
  'secondary-100': 'bg-secondary-100',
  'secondary-200': 'bg-secondary-200',
  'secondary-300': 'bg-secondary-300',
  'secondary-400': 'bg-secondary-400',
  'secondary-500': 'bg-secondary-500',
  'secondary-600': 'bg-secondary-600',
  'secondary-700': 'bg-secondary-700',
  'accent-300': 'bg-accent-300',
  'accent-400': 'bg-accent-400',
  'accent-500': 'bg-accent-500',
  'accent-600': 'bg-accent-600',
  'accent-700': 'bg-accent-700',
  background: 'bg-background',
  surface: 'bg-surface',
  'surface-2': 'bg-surface-2',
  'surface-inset': 'bg-surface-inset',
  divider: 'bg-divider',
  foreground: 'bg-foreground',
  'muted-foreground': 'bg-muted-foreground',
  success: 'bg-success',
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
};

// The semantic swatches follow the theme toggle live, since the class resolves to the token.
const Swatch = ({ token, note }: { token: string; note?: string }) => (
  <div className="min-w-0">
    <div
      className={`h-11 rounded-lg border border-foreground/10 shadow-[inset_0_1px_0_oklch(1_0_0/0.08)] ${SWATCH_BG[token] ?? ''}`}
    />
    {/* Wraps rather than truncates: a token name is something to copy, so it has to be there whole. */}
    <p className="mt-1.5 font-mono text-[0.7rem] leading-4 text-gray-400 [overflow-wrap:anywhere]">{token}</p>
    {note ? <p className="truncate font-mono text-[0.65rem] text-gray-500">{note}</p> : null}
  </div>
);

const SWATCH_GRID = 'grid grid-cols-5 gap-x-2 gap-y-3 sm:grid-cols-10';

const ColourSection = () => (
  <DocSection id="colour" title="Colour" kicker="OKLCH tokens">
    <Prose>
      <p>
        The three hue ramps are the same in both themes; only the canvas and text tokens swap under <Code>.dark</Code>.
        Every value is authored in OKLCH, with the hex kept as a design reference.
      </p>
    </Prose>
    <div className="space-y-9">
      {RAMPS.map((ramp) => (
        <DocSubsection key={ramp.id} id={ramp.id} title={ramp.title}>
          <div className={`mt-3 ${SWATCH_GRID}`}>
            {ramp.steps.map((step) => (
              <Swatch
                key={step}
                token={`${ramp.token}-${step}`}
                note={step === ramp.anchor.step ? ramp.anchor.hex : undefined}
              />
            ))}
          </div>
        </DocSubsection>
      ))}
      <DocSubsection id="colour-canvas" title="Canvas & text — follow the theme">
        <div className={`mt-3 ${SWATCH_GRID}`}>
          {CANVAS_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </div>
      </DocSubsection>
      <DocSubsection id="colour-status" title="Status">
        <div className={`mt-3 ${SWATCH_GRID}`}>
          {STATUS_TOKENS.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </div>
      </DocSubsection>
      <DocSubsection id="colour-gradient" title="Brand gradient">
        <p className="mb-3 max-w-[33rem] text-sm leading-6 text-gray-400">
          Lavender into rose, kept for the moments that matter: the primary action, one gradient word, a playhead.
        </p>
        <div className="brand-gradient h-14 rounded-xl" />
        <p className="mt-1.5 font-mono text-[0.7rem] text-gray-400">brand-gradient</p>
      </DocSubsection>
    </div>
  </DocSection>
);

// ── Typography ────────────────────────────────────────────────────────────────

// The display ramp KineticHeading draws from, largest first, with each clamp()'s floor and ceiling.
const DISPLAY_STEPS = [
  { token: 'mega', range: '3.1 → 7.5rem' },
  { token: 'hero', range: '3 → 4.5rem' },
  { token: 'xl', range: '2.5 → 3.5rem' },
  { token: 'l', range: '2 → 2.75rem' },
  { token: 'm', range: '1.65 → 2.125rem' },
  { token: 's', range: '1.4 → 1.75rem' },
] as const;

const TypeSection = () => (
  <DocSection id="typography" title="Typography" kicker="Oswald">
    <Prose>
      <p>
        Oswald (<Code>--font-sans</Code>, <Code>--font-display</Code>) sets the interface and its headlines — a
        condensed face, for the bold, headline-forward feel. Text burned into a video uses the fonts bundled in{' '}
        <Code>@leclap/creative-kit/fonts</Code> instead.
      </p>
    </Prose>
    <DocSubsection id="type-display" title="Display ramp">
      {/* Each step is a fluid clamp(), so the specimen is the real size at this viewport. `truncate`
          keeps the largest steps to one line on a phone instead of stacking a wall of type. */}
      <ul className="mt-3 divide-y divide-divider border-y border-divider">
        {DISPLAY_STEPS.map((step) => (
          <li
            key={step.token}
            className="grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-baseline"
          >
            <div className="font-mono text-[0.72rem] leading-5">
              <p className="text-foreground">--text-display-{step.token}</p>
              <p className="text-gray-500">{step.range}</p>
            </div>
            <p
              className="truncate font-display font-bold tracking-tight text-foreground"
              style={{ fontSize: `var(--text-display-${step.token})`, lineHeight: 1.05 }}
            >
              Take one.
            </p>
          </li>
        ))}
      </ul>
    </DocSubsection>
    <DocSubsection id="type-text" title="Text styles">
      <dl className="mt-3 grid gap-6 sm:grid-cols-3">
        <div>
          <dt className="mb-2 font-mono text-[0.72rem] text-gray-500">Eyebrow</dt>
          <dd>
            <Eyebrow kicker="Live catalogue" />
          </dd>
        </div>
        <div>
          <dt className="mb-2 font-mono text-[0.72rem] text-gray-500">Body — 1rem / 1.75</dt>
          <dd className="text-base leading-7 text-gray-300">
            A descriptor is a single JSON document the engine compiles into a finished video.
          </dd>
        </div>
        <div>
          <dt className="mb-2 font-mono text-[0.72rem] text-gray-500">Inline code</dt>
          <dd className="text-base leading-7 text-gray-300">
            Set <Code>global.audio</Code> once.
          </dd>
        </div>
      </dl>
    </DocSubsection>
  </DocSection>
);

// ── Motion ────────────────────────────────────────────────────────────────────

// What each curve carries, as index.css uses it.
const EASINGS = [
  { token: '--ease-smooth', use: 'A press going down, theme cross-fades, a page leaving.' },
  { token: '--ease-spring', use: 'Pop-ins and a press springing back — the overshoot is the point.' },
  { token: '--ease-out-expo', use: 'Entrances: content fading up, a route arriving.' },
] as const;
const DURATIONS = ['--dur-fast', '--dur-base', '--dur-slow', '--dur-ring'] as const;

// The demo stretches every curve over the same, deliberately slow run so its shape can be read.
const DEMO_MS = 900;

const readToken = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const EasingCurve = ({ bezier }: { bezier: Bezier }) => (
  <svg viewBox="-8 -32 116 148" className="h-20 w-20 shrink-0 overflow-visible" aria-hidden="true">
    <rect x="0" y="0" width="100" height="100" rx="4" className="fill-foreground/[0.03] stroke-divider" />
    <path d={bezierPath(bezier, 100)} className="fill-none stroke-brand-500" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const MotionSection = () => {
  const [played, setPlayed] = useState(false);
  // Read once on mount: the page is client-rendered, and the tokens don't change at runtime.
  const [curves] = useState(() =>
    EASINGS.map((easing) => {
      const value = readToken(easing.token);

      return { ...easing, value, bezier: parseCubicBezier(value) };
    })
  );
  const [durations] = useState(() => DURATIONS.map((token) => ({ token, ms: durationMs(readToken(token)) })));

  return (
    <DocSection id="motion" title="Motion" kicker="Easing & duration">
      <Prose>
        <p>
          Three shared curves instead of ad-hoc transitions, so every surface moves as if one hand made it — and
          everything settles under <Code>prefers-reduced-motion</Code>.
        </p>
      </Prose>
      <DocSubsection id="motion-easing" title="Easing">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[28rem] text-sm leading-6 text-gray-400">
            Each dot crosses the same track in {DEMO_MS} ms, slowed down so the shape of the curve reads.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPlayed((value) => !value);
            }}
          >
            <PlayIcon size={14} className={played ? 'rotate-180' : undefined} /> {played ? 'Reverse' : 'Play'}
          </Button>
        </div>
        <ul className="divide-y divide-divider rounded-2xl border border-divider bg-surface/60">
          {curves.map((curve) => (
            <li key={curve.token} className="flex items-center gap-4 px-4 py-4 sm:gap-6 sm:px-5">
              {curve.bezier ? <EasingCurve bezier={curve.bezier} /> : null}
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold text-foreground">{curve.token}</p>
                <p className="truncate font-mono text-[0.72rem] text-secondary-700 dark:text-secondary-300">
                  {curve.value}
                </p>
                <p className="mt-1 text-sm leading-6 text-gray-400">{curve.use}</p>
                {/* The dot rides a track-minus-dot wide carriage, so translating the carriage by its own
                    width lands the dot exactly at the end — transform only, no animated `left`. */}
                <div className="relative mt-3 h-3 rounded-full bg-foreground/[0.07]">
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[calc(100%-0.75rem)]"
                    style={{
                      transform: played ? 'translateX(100%)' : 'translateX(0)',
                      transition: `transform ${DEMO_MS}ms var(${curve.token})`,
                    }}
                  >
                    <span className="block h-3 w-3 rounded-full bg-brand-500 shadow-[0_0_12px_oklch(0.663_0.178_277.9/0.6)]" />
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </DocSubsection>
      <DocSubsection id="motion-duration" title="Duration">
        <ul className="mt-3 flex flex-wrap gap-2">
          {durations.map((duration) => (
            <li
              key={duration.token}
              className="rounded-lg border border-divider bg-surface-2 px-3 py-2 font-mono text-[0.78rem] text-gray-300"
            >
              {duration.token}
              <span className="ml-2 text-secondary-700 dark:text-secondary-300">
                {duration.ms === null ? '—' : `${duration.ms} ms`}
              </span>
            </li>
          ))}
        </ul>
      </DocSubsection>
    </DocSection>
  );
};

// ── Components ────────────────────────────────────────────────────────────────

const ColorPickerDemo = () => {
  const [color, setColor] = useState('#7c83fd');

  return (
    <div className="max-w-sm">
      <ColorPicker aria-label="Demo color" value={color} onChange={setColor} />
      <p className="mt-2 text-xs text-gray-400">
        Selected: <span className="font-mono text-foreground">{color}</span>
      </p>
    </div>
  );
};

const ComponentsSection = () => (
  <DocSection id="components" title="Components" kicker="shadcn/ui + Radix">
    <div className="space-y-10">
      <DocSubsection id="buttons" title="Buttons">
        <div className="mt-3 flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">
            <SparklesIcon size={16} /> Large
          </Button>
          <Button size="icon" aria-label="Play">
            <PlayIcon size={16} />
          </Button>
          <Button disabled>Disabled</Button>
          <Button asChild variant="secondary">
            <a href="#buttons">
              <Download /> As link
            </a>
          </Button>
        </div>
      </DocSubsection>

      <DocSubsection id="badges" title="Badges">
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="brand">Brand</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="success">Success</Badge>
        </div>
      </DocSubsection>

      <DocSubsection id="cards" title="Cards">
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Raised</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-400">Default elevation surface.</CardContent>
          </Card>
          <Card elevation="floating">
            <CardHeader>
              <CardTitle>Floating</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-400">More depth for overlays.</CardContent>
          </Card>
          <Card interactive gradientBorder>
            <CardHeader>
              <CardTitle>Interactive</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-400">Hover for the brand pop + gradient ring.</CardContent>
          </Card>
        </div>
      </DocSubsection>

      <DocSubsection id="input" title="Input">
        <div className="mt-3 max-w-sm">
          <Input placeholder="Your name" aria-label="Your name" />
        </div>
      </DocSubsection>

      <DocSubsection id="color-picker" title="Color picker">
        <div className="mt-3">
          <ColorPickerDemo />
        </div>
      </DocSubsection>

      <DocSubsection id="video-player" title="Video player">
        <p className="mb-3 max-w-[33rem] text-sm leading-6 text-gray-400">
          The render result player, in a landscape and a portrait frame.
        </p>
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div data-testid="player-landscape">
            <VideoPreview url="/videos/showcase/effects-tour.mp4" title="Effects tour" />
          </div>
          <div data-testid="player-portrait" className="mx-auto aspect-[9/16] w-full max-w-60">
            <VideoPreview url="/videos/films/leclap-agentic-portrait.en.mp4" fill label={null} />
          </div>
        </div>
      </DocSubsection>

      <DocSubsection id="dialog" title="Dialog">
        <p className="mb-3 max-w-[33rem] text-sm leading-6 text-gray-400">
          Radix: focus trap, Escape to close, scroll lock.
        </p>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete template?</DialogTitle>
              <DialogDescription>
                This can't be undone. The template will be removed from this browser.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger">Delete</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DocSubsection>
    </div>
  </DocSection>
);

export const Design = () => (
  <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-background text-foreground bg-dots">
    <Seo
      title="Design System"
      description="The LeClap design system — colors, typography, motion and UI components."
      path="/design"
    />
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute right-1/4 top-0 h-96 w-96 rounded-full bg-brand-500/10 blur-[120px] animate-float" />
      <div
        className="absolute bottom-0 left-1/4 h-96 w-96 rounded-full bg-secondary-400/10 blur-[120px] animate-float"
        style={{ animationDelay: '-3s' }}
      />
    </div>
    <div className="relative z-10 container mx-auto max-w-5xl px-4 pb-16 pt-24 lg:pt-28">
      <header className="mb-14">
        <Eyebrow kicker="Tokens & components" className="mb-3" />
        <KineticHeading text="Design System" as="h1" level="l" />
        <p className="mt-4 max-w-[33rem] text-[1.0625rem] leading-[1.7] text-gray-300">
          shadcn/ui + Radix primitives, styled with the LeClap brand tokens (OKLCH, light/dark).
        </p>
      </header>

      <ColourSection />
      <TypeSection />
      <MotionSection />
      <ComponentsSection />
    </div>
  </div>
);
