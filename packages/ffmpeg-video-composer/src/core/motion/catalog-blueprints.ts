// Scene blueprints: time-coded, validated LeClap sections with `[slot]` placeholders in the copy. An
// agent picks one per narrative role, fills the slots and keeps the signature move; the rest (colours,
// sizes, delays) adapts to the brief. Each blueprint carries its own assertions, so a variation that
// breaks the choreography fails validation instead of shipping.

export type BlueprintRole = 'hook' | 'problem' | 'product-intro' | 'proof' | 'cta' | 'outro';

export interface MotionBlueprint {
  name: string;
  roles: BlueprintRole[];
  /** Seconds this scene reads best in: [min, max]. */
  bestSpan: [number, number];
  /** The move that makes the scene; keep it when adapting. */
  signatureMove: string;
  useWhen: string;
  avoidWhen: string;
  /** A complete section; replace every `[slot]` in the copy. */
  section: Record<string, unknown>;
}

function scene(
  name: string,
  duration: number,
  color: string,
  motion: Record<string, unknown>
): Record<string, unknown> {
  return { name, type: 'color_background', options: { backgroundColor: color, duration }, ...motion };
}

function text(slot: string): { en: string } {
  return { en: `[${slot}]` };
}

export const MOTION_BLUEPRINTS: MotionBlueprint[] = [
  {
    name: 'cold-open-slam',
    roles: ['hook'],
    bestSpan: [1.2, 2.5],
    signatureMove: 'One word SLAMS at 0.2 s on a camera hit and a white flash, all on the same frame.',
    useWhen: 'the first beat of a social or launch video',
    avoidWhen: 'calm tutorials or a brand that never shouts',
    section: scene('hook', 2, '#0E0E12', {
      kinetic: [{ text: text('word'), preset: 'impact', delay: 0.2, size: 180 }],
      camera: { hits: [0.25], shake: { amplitude: 3 } },
      graphics: [{ type: 'flash', at: 0.25, duration: 0.25 }],
      assert: [{ visibleBy: { target: 'kinetic[0]', at: 0.8 } }],
    }),
  },
  {
    name: 'question-typed',
    roles: ['hook', 'problem'],
    bestSpan: [2.5, 4],
    signatureMove: 'The question TYPES behind a caret while the frame TRACES around it.',
    useWhen: 'opening on a question, a prompt or a developer audience',
    avoidWhen: 'copy over ~40 characters',
    section: scene('question', 3.2, '#101418', {
      kinetic: [{ text: text('question'), preset: 'typewriter', delay: 0.3, font: 'mono', size: 54 }],
      graphics: [{ type: 'frame', at: 0.2, duration: 1.2, inset: 64 }],
      camera: { preset: 'push-in', amount: 0.05 },
    }),
  },
  {
    name: 'problem-highlight',
    roles: ['problem'],
    bestSpan: [3, 4.5],
    signatureMove: 'The statement CASCADES, then the pain word is MARKED by a sweeping marker.',
    useWhen: 'naming the pain point in one sentence',
    avoidWhen: 'more than one accent word',
    section: scene('problem', 3.6, '#17121C', {
      kinetic: [{ text: text('pain statement'), preset: 'highlight', delay: 0.25, accent: { words: 'last' } }],
      camera: { preset: 'drift-left', amount: 0.06 },
      assert: [{ keepsMoving: { maxStill: 2.5 } }],
    }),
  },
  {
    name: 'product-reveal',
    roles: ['product-intro'],
    bestSpan: [3.5, 5],
    signatureMove: 'A panel GROWS, the product name TIGHTENS onto it, then an underline DRAWS beneath.',
    useWhen: 'introducing the product name for the first time',
    avoidWhen: 'portrait frames with long product names',
    section: scene('product', 4, '#0B0B0F', {
      graphics: [
        { type: 'panel', at: 0.2, duration: 0.6, x: 0, y: 250, width: 1280, height: 220, color: '#1C1C28' },
        { type: 'underline', at: 1.9, duration: 0.5, x: 440, y: 450, width: 400, ease: '$smooth' },
      ],
      kinetic: [{ text: text('product'), preset: 'tracking-in', delay: 0.5, size: 120, y: 280 }],
      camera: { preset: 'push-in', amount: 0.06, delay: 0.4 },
      assert: [{ before: ['graphics[0]', 'graphics[1]'] }, { inFrame: 'kinetic[0]' }],
    }),
  },
  {
    name: 'feature-stack',
    roles: ['product-intro', 'proof'],
    bestSpan: [4.5, 6.5],
    signatureMove: 'Three features RISE one by one, about a second apart, through the back half of the beat.',
    useWhen: 'listing two to four features or steps',
    avoidWhen: 'more than four items (split into two beats)',
    section: scene('features', 5.4, '#111118', {
      kinetic: [
        { text: text('feature one'), preset: 'rise', delay: 0.3, size: 64, y: 180 },
        { text: text('feature two'), preset: 'rise', delay: 1.4, size: 64, y: 300, ease: '$smooth' },
        { text: text('feature three'), preset: 'rise', delay: 2.5, size: 64, y: 420, ease: '$snappy' },
      ],
      camera: { preset: 'drift-up', amount: 0.04 },
      assert: [{ before: ['kinetic[0]', 'kinetic[1]'] }, { before: ['kinetic[1]', 'kinetic[2]'] }],
    }),
  },
  {
    name: 'stat-proof',
    roles: ['proof'],
    bestSpan: [3, 4.5],
    signatureMove: 'The number COUNTS up inside corner BRACKETS; the label FADES in after it settles.',
    useWhen: 'a single metric proves the claim',
    avoidWhen: 'several numbers in one beat',
    section: scene('stat', 3.6, '#0F1115', {
      graphics: [{ type: 'corners', at: 0.15, duration: 0.5 }],
      kinetic: [
        { text: text('stat'), preset: 'counter', counter: { from: 0, to: 100, suffix: '%' }, delay: 0.3, size: 150 },
        { text: text('label'), preset: 'fade', delay: 1.9, size: 40, y: 'bottom' },
      ],
      assert: [{ before: ['kinetic[0]', 'kinetic[1]'] }],
    }),
  },
  {
    name: 'quote-proof',
    roles: ['proof'],
    bestSpan: [4, 6],
    signatureMove: 'The quote FADES in by line on a slow drift; the attribution SLIDES in last.',
    useWhen: 'a testimonial or press quote',
    avoidWhen: 'quotes over two lines',
    section: scene('quote', 5, '#14121A', {
      kinetic: [
        { text: text('quote'), preset: 'fade', unit: 'line', delay: 0.3, size: 58 },
        { text: text('attribution'), preset: 'slide', delay: 2.2, size: 34, y: 'bottom', ease: '$smooth' },
      ],
      camera: { preset: 'drift-right', amount: 0.05 },
      assert: [{ keepsMoving: { maxStill: 2.5 } }],
    }),
  },
  {
    name: 'cta-lockup',
    roles: ['cta'],
    bestSpan: [2.5, 4],
    signatureMove: 'The call to action CASCADES, then an underline DRAWS under it as the camera LEANS IN.',
    useWhen: 'the ask: sign up, download, visit',
    avoidWhen: 'more than one ask',
    section: scene('cta', 3.2, '#0B0B0F', {
      kinetic: [
        { text: text('call to action'), preset: 'cascade', delay: 0.2, size: 96, accent: { words: 'last' } },
        { text: text('url'), preset: 'fade', delay: 1.2, size: 36, y: 'bottom' },
      ],
      graphics: [{ type: 'underline', at: 0.9, duration: 0.45, x: 440, y: 430, width: 400 }],
      camera: { preset: 'push-in', amount: 0.05 },
      assert: [{ visibleBy: { target: 'kinetic[0]', at: 1.2 } }],
    }),
  },
  {
    name: 'trailer-title',
    roles: ['hook', 'outro'],
    bestSpan: [3, 5],
    signatureMove: 'Bars LETTERBOX the frame, the title TIGHTENS in and the camera SWAYS.',
    useWhen: 'a cinematic title or chapter card',
    avoidWhen: 'portrait social video or playful brands',
    section: scene('title', 4, '#050507', {
      graphics: [{ type: 'bars', at: 0, duration: 0.8 }],
      kinetic: [{ text: text('title'), preset: 'tracking-in', delay: 0.6, size: 110, color: '#EDE6D6' }],
      camera: { preset: 'push-in', amount: 0.08, shake: { amplitude: 3, frequency: 0.5 } },
    }),
  },
  {
    name: 'outro-signoff',
    roles: ['outro'],
    bestSpan: [2.5, 4],
    signatureMove: 'The brand line LOCKS in from both sides while the camera PULLS BACK.',
    useWhen: 'the last beat: brand, tagline, sign-off',
    avoidWhen: 'an ending that must hold a long legal line',
    section: scene('outro', 3.4, '#0B0B0F', {
      kinetic: [
        { text: text('brand'), preset: 'split', delay: 0.25, size: 120 },
        { text: text('tagline'), preset: 'fade', delay: 1.3, size: 38, y: 'bottom' },
      ],
      camera: { preset: 'pull-out', amount: 0.06 },
      assert: [{ before: ['kinetic[0]', 'kinetic[1]'] }],
    }),
  },
];
