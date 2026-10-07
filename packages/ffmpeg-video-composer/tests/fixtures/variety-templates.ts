// Variety eval fixtures: five templates as a generator following the "compose, don't pick" steer would
// write them for five different briefs (the brief sits in meta.creativeDirection). Each derives its motion
// from its own direction: its own kinetic presets, camera, transitions and one or two tuned signature fx.
// SLOP_TEMPLATES is the negative control: the same five briefs answered with one stock recipe.

type Loose = Record<string, unknown>;

interface Beat {
  name: string;
  copy: string;
  preset: string;
  seconds: number;
  camera?: Loose;
  graphics?: Loose[];
  transition?: Loose;
  /** Extra kinetic fields (a counter's from/to). */
  block?: Loose;
}

interface Brief {
  name: string;
  brief: string;
  theme: string;
  energy: number;
  seed: number;
  beats: Beat[];
}

function section(beat: Beat): Loose {
  return {
    name: beat.name,
    type: 'color_background',
    options: { duration: beat.seconds, backgroundColor: '$color.bg' },
    kinetic: [{ text: { en: beat.copy }, preset: beat.preset, delay: 0.2, ...beat.block }],
    ...(beat.camera && { camera: beat.camera }),
    ...(beat.graphics && { graphics: beat.graphics }),
    ...(beat.transition && { transition: beat.transition }),
  };
}

function template(brief: Brief): Loose {
  return {
    meta: { name: brief.name, creativeDirection: brief.brief },
    global: {
      orientation: 'landscape',
      fps: 30,
      musicEnabled: false,
      theme: brief.theme,
      seed: brief.seed,
      motion: { energy: brief.energy },
    },
    sections: brief.beats.map(section),
  };
}

const CARD = { x: 'iw*0.18', y: 'ih*0.22', w: 'iw*0.64', h: 'ih*0.56', radius: 28 };

export const BRIEFS: Brief[] = [
  {
    name: 'Atelier watch launch',
    brief: 'Luxury watch launch for collectors: hushed, precise, one slow reflection on the dial; no bounce.',
    theme: 'editorial',
    energy: 0.8,
    seed: 11,
    beats: [
      { name: 'hook', copy: 'Time, refined.', preset: 'tracking-in', seconds: 3, camera: { preset: 'push-in' } },
      {
        name: 'dial',
        copy: 'Hand-finished dial',
        preset: 'rise',
        seconds: 4,
        camera: { preset: 'orbit' },
        graphics: [
          {
            type: 'fx',
            effect: 'sheen',
            target: CARD,
            profile: 'soft',
            width: 0.32,
            tilt: 38,
            direction: 'left',
            color: '$color.accent',
            duration: 1.6,
            ease: '$smooth',
            at: 1.2,
          },
        ],
        transition: { type: 'fadeblack', duration: 0.6 },
      },
      { name: 'cta', copy: 'Reserve yours', preset: 'fade', seconds: 3.5 },
    ],
  },
  {
    name: 'Ledger explainer',
    brief: 'Fintech explainer for small-business owners: clear and trustworthy, numbers count up, calm cuts.',
    theme: 'paper',
    energy: 0.9,
    seed: 23,
    beats: [
      { name: 'problem', copy: 'Invoices pile up', preset: 'typewriter', seconds: 2.5 },
      {
        name: 'stat',
        copy: '42 hours saved',
        preset: 'counter',
        seconds: 3,
        block: { counter: { from: 0, to: 42 } },
        camera: { preset: 'drift-right' },
      },
      {
        name: 'proof',
        copy: 'Paid in two days',
        preset: 'highlight',
        seconds: 3,
        graphics: [{ type: 'underline', x: 120, y: 470, width: 520, color: '$color.accent' }],
        transition: { type: 'push-left' },
      },
      { name: 'cta', copy: 'Start free', preset: 'split', seconds: 2.5 },
    ],
  },
  {
    name: 'Drop day sneakers',
    brief: 'Sneaker drop for Gen-Z on TikTok: loud, on the beat, one chrome glint on the shoe card.',
    theme: 'bold',
    energy: 1.4,
    seed: 37,
    beats: [
      { name: 'hook', copy: 'DROP', preset: 'impact', seconds: 1, camera: { preset: 'handheld' } },
      {
        name: 'shoe',
        copy: 'Chrome runner',
        preset: 'pop',
        seconds: 1.8,
        graphics: [
          {
            type: 'fx',
            effect: 'sheen',
            target: CARD,
            profile: 'twin',
            width: 0.06,
            tilt: -24,
            direction: 'right',
            color: '$color.fg',
            duration: 0.45,
            ease: '$snappy',
            repeat: 2,
            every: 0.7,
            at: 0.3,
          },
        ],
        transition: { type: 'whip-left', duration: 0.35 },
      },
      { name: 'price', copy: '$129', preset: 'drop', seconds: 1.2 },
      { name: 'cta', copy: 'Link in bio', preset: 'scramble', seconds: 1.5 },
    ],
  },
  {
    name: 'Morning flow',
    brief: 'Yoga app tutorial for beginners: quiet, legible, gentle drifts; nothing flashes.',
    theme: 'midnight',
    energy: 0.6,
    seed: 41,
    beats: [
      { name: 'intro', copy: 'Breathe in', preset: 'wave', seconds: 4, camera: { preset: 'drift-up' } },
      { name: 'step', copy: 'Roll down slowly', preset: 'cascade', seconds: 5, camera: { preset: 'pull-out' } },
      { name: 'outro', copy: 'See you tomorrow', preset: 'fade', seconds: 4 },
    ],
  },
  {
    name: 'Hollow keep trailer',
    brief: 'Indie game trailer: tension then release, dark, a single cold glint on the title lockup.',
    theme: 'neon',
    energy: 1.1,
    seed: 53,
    beats: [
      { name: 'tease', copy: 'They sealed the keep', preset: 'slide', seconds: 3, camera: { preset: 'drift-left' } },
      {
        name: 'title',
        copy: 'HOLLOW KEEP',
        block: { id: 'lockup' },
        preset: 'tracking-in',
        seconds: 4,
        graphics: [
          {
            type: 'fx',
            effect: 'sheen',
            target: 'text:0',
            profile: 'specular',
            width: 0.12,
            tilt: 8,
            direction: 'down',
            bloom: 0.45,
            intensity: 0.7,
            duration: 0.9,
            ease: '$expo',
            at: 'lockup.end',
          },
        ],
        transition: { type: 'iris', duration: 0.6 },
      },
      { name: 'date', copy: 'Winter 2027', preset: 'split', seconds: 2.5 },
    ],
  },
];

export const VARIED_TEMPLATES = BRIEFS.map(template);

const STOCK_SHEEN = { type: 'fx', effect: 'sheen', target: CARD };

// The same briefs, one recipe: rise everywhere, push-in everywhere, an untuned sheen on every beat.
export const SLOP_TEMPLATES = BRIEFS.map((brief) =>
  template({
    ...brief,
    beats: brief.beats.map((beat) => ({
      name: beat.name,
      copy: beat.copy,
      seconds: beat.seconds,
      preset: 'rise',
      camera: { preset: 'push-in' },
      graphics: [STOCK_SHEEN],
    })),
  })
);
