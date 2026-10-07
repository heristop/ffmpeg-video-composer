// `leclap init --studio <dir>`: a file-based production folder. The brief, style guide and shot list are
// the source of truth; template.json is wired to them (meta.brief, a purpose and role per beat), and
// studio.json records which production gate has been passed and when (see studio.ts).

import { GATES, type StudioManifest } from './studio.js';

interface Beat {
  name: string;
  role: string;
  seconds: number;
  entry: string;
  exit: string;
  purpose: string;
  copy: string;
  preset: string;
}

const BEATS: Beat[] = [
  {
    name: 'hook',
    role: 'hook',
    seconds: 2.5,
    entry: 'cut in on a dark frame',
    exit: 'headline settled, hard cut',
    purpose: 'Stop the scroll with the one promise the film keeps.',
    copy: 'Your promise here',
    preset: 'cascade',
  },
  {
    name: 'problem',
    role: 'problem',
    seconds: 3.5,
    entry: 'the tension appears',
    exit: 'the problem is named',
    purpose: 'Name the pain the audience already feels, in their words.',
    copy: 'The problem, plainly',
    preset: 'rise',
  },
  {
    name: 'reveal',
    role: 'reveal',
    seconds: 4,
    entry: 'a pause, then the product',
    exit: 'the product holds center frame',
    purpose: 'Show the product as the answer, one clear idea.',
    copy: 'Meet the answer',
    preset: 'tracking-in',
  },
  {
    name: 'proof',
    role: 'proof',
    seconds: 4,
    entry: 'evidence lands',
    exit: 'the evidence is readable',
    purpose: 'Prove the claim with one approved fact or quote.',
    copy: 'One approved fact',
    preset: 'rise',
  },
  {
    name: 'cta',
    role: 'cta',
    seconds: 3.5,
    entry: 'calm, centered',
    exit: 'logo and action held to the end',
    purpose: 'Tell the viewer exactly what to do next.',
    copy: 'Do this next',
    preset: 'split',
  },
];

const DIRECTION =
  'See brief.md and style-guide.md: they are the source of truth. One idea per beat, approved copy only ' +
  '(never invent claims, numbers, names or logos), editorial palette, headlines land and hold, overshoot ' +
  'only for one playful element, review contact sheets before every render.';

function section(beat: Beat): Record<string, unknown> {
  return {
    name: beat.name,
    type: 'color_background',
    role: beat.role,
    purpose: beat.purpose,
    options: { backgroundColor: '$color.bg', duration: beat.seconds },
    kinetic: [{ text: { en: beat.copy }, preset: beat.preset, role: 'headline', color: '$color.fg', delay: 0.2 }],
  };
}

export function studioTemplate(name: string): Record<string, unknown> {
  return {
    meta: { name, brief: 'brief.md', creativeDirection: DIRECTION },
    global: {
      orientation: 'landscape',
      fps: 30,
      musicEnabled: false,
      seed: 1,
      theme: 'editorial',
      motion: { energy: 1 },
    },
    sections: BEATS.map(section),
  };
}

function brief(name: string): string {
  return `# Brief: ${name}

## The film in one line

<!-- One sentence: who sees it, what they feel, what they do next. -->

## Audience

- Who:
- What they already believe:
- What they should believe after:

## Duration and formats

- Duration: ${BEATS.reduce((total, beat) => total + beat.seconds, 0)} s (adjust the shot list, not this line alone)
- Formats: 16:9 master; 9:16 and 1:1 cut-downs if needed

## Approved assets

<!-- Every file in assets/ with its source and usage rights. Nothing else goes on screen. -->

| File | Source | Rights | Notes |
| ---- | ------ | ------ | ----- |

## Approved copy

<!-- Every on-screen word, verbatim. The template may only use these lines. -->

## Keep / avoid

- Keep:
- Avoid:

## Never invent

- No claims, numbers, quotes, names, prices or logos that are not listed above.
- No stock imagery or placeholder people presented as real customers.
- When something is missing, leave a visible placeholder and note it in reviews/, do not make it up.
`;
}

function styleGuide(): string {
  return `# Style guide

## Palette

- Theme: \`editorial\` (global.theme). Colours by token only: \`$color.bg\`, \`$color.fg\`, \`$color.accent\`.
- One accent per idea.

## Type

- Display for headlines, body for supporting copy. At most two sizes per beat.

## Composition

- One dominant element per beat; generous negative space; keep copy inside the title-safe area.

## Pacing

- Vary beat lengths: the slowest beat about 3x the fastest.
- Start text 0.1 to 0.3 s after the cut; hold every headline 0.4 s + words / 3.5 s after it lands.

## Motion roles

| Role     | Use for                      | Feel                     |
| -------- | ---------------------------- | ------------------------ |
| micro    | chips, icons, small labels   | quick, no overshoot      |
| panel    | cards, plates, bands         | controlled settle        |
| camera   | push-ins, drifts             | smooth, near-invisible   |
| headline | hero copy                    | strong entrance, hold    |
| accent   | one emphasised word          | snappy                   |
| mascot   | playful props                | the only visible bounce  |

Set \`role\` on elements instead of hand-picking eases; tune a role once in \`global.motion.roles\`.

## Banned defaults

- Every element bouncing in.
- The same preset three beats in a row.
- Exits right before a transition (the transition is the exit).
- Centered everything with no hierarchy.
`;
}

function shotlist(): string {
  let clock = 0;
  const rows = BEATS.map((beat) => {
    const row = `| ${clock.toFixed(1)}–${(clock + beat.seconds).toFixed(1)} s | ${beat.role} | ${beat.entry} | ${beat.exit} | ${beat.purpose} |`;
    clock += beat.seconds;

    return row;
  });

  return `# Shot list

One row per beat; each row is a section of template.json (same order, \`role\` and \`purpose\`).

| Time | Role | Entry state | Exit state | Purpose |
| ---- | ---- | ----------- | ---------- | ------- |
${rows.join('\n')}
`;
}

const REVIEWS_README = `# Reviews

## Contact sheets

Before each render, export stills of every beat (entrance, settled hold, ending) and drop them here as
\`<pass>-<beat>.png\`. Check them against brief.md and style-guide.md.

## Defect notes

One file per review pass, e.g. \`rough-cut-1.md\`, one entry per defect:

\`\`\`md
- **00:03.2**: headline clipped on the right edge
  - Evidence: rough-cut-1-problem.png
  - Local fix: sections[1].kinetic[0].maxWidth 1500
\`\`\`

Fix locally (one field, one section) and re-check the same timestamp; never redesign during repair.
`;

export function studioManifest(name: string, now: Date): StudioManifest {
  return {
    version: 1,
    name,
    createdAt: now.toISOString(),
    gates: Object.fromEntries(GATES.map((gate) => [gate.id, null])),
  };
}

/** Pure: the studio folder's files keyed by folder-relative path. */
export function studioFiles(name: string, now: Date = new Date()): Record<string, string> {
  return {
    'brief.md': brief(name),
    'style-guide.md': styleGuide(),
    'shotlist.md': shotlist(),
    'template.json': `${JSON.stringify(studioTemplate(name), null, 2)}\n`,
    'studio.json': `${JSON.stringify(studioManifest(name, now), null, 2)}\n`,
    'assets/.gitkeep': '',
    'reviews/README.md': REVIEWS_README,
    'out/.gitkeep': '',
  };
}
