// Sameness lint: advisory findings for motion that reads as assembled from stock parts rather than
// authored for the brief. Read off the expanded descriptor like the pacing lint (motion-lint.ts registers
// them); they never enter `errors` and never flip `success`. Each finding carries a one-line hint.
//
// - fx_untuned: an fx graphic that sets none of its look parameters (it renders context defaults only).
// - effect_repeated: one fx effect, decorative graphic, kinetic preset or camera preset drives more than
//   SAME_EFFECT_MAX_SECTIONS sections and more than half of them.
// - library_animation_sample: a section input or whole-video animation using a creative-kit library APNG
//   (a demo sample, core/motion/library-samples.ts) instead of motion composed with the engine.
// - effect_off_theme: an fx, frame or corners graphic whose colour ignores the template's palette: a
//   literal instead of a $color token once global.theme is set, else a hex used nowhere else.
// - decor_overload: more than DECOR_MAX_PER_SECTION decorative effects (fx, light hits, frames, animation
//   overlays) layered in one section.

import { FX_PRIMITIVES } from '../schemas/fx-primitives.schemas';
import { librarySampleOf, type LibrarySample } from '@/core/motion/library-samples';
import { RENDERING_SECTION_TYPES } from '@/core/motion/timeline';
import { parseHexColor } from '@/core/theme/palette';

/** Same shape as motion-lint's MotionWarning (declared here so the two modules don't import each other). */
export interface SamenessWarning {
  path: string;
  code: string;
  message: string;
  severity: 'warn';
  hint: string;
}

/** effect_repeated: an effect may drive this many sections before it reads as a house style. */
export const SAME_EFFECT_MAX_SECTIONS = 3;
/** effect_repeated also needs more than this share of the rendering sections. */
export const SAME_EFFECT_MIN_SHARE = 0.5;
/** decor_overload: decorative effects one section may layer (doctrine: one hero, at most two layered). */
export const DECOR_MAX_PER_SECTION = 2;
/** effect_off_theme (no theme): per-channel distance under which a colour matches one used elsewhere. */
export const OFF_PALETTE_DELTA = 24;

/** Shared fx fields that tune the look (placement fields such as target/at/until do not). */
const FX_LOOK_FIELDS = ['color', 'intensity', 'duration', 'ease', 'repeat', 'every', 'seed', 'role'];
const DECOR_GRAPHICS = new Set(['flash', 'glitch', 'frame', 'corners', 'wipe', 'focus']);
/** Decorative graphics whose colour is a look choice (panels, wipes and rules are layout surfaces). */
const COLOURED_GRAPHICS = new Set(['frame', 'corners']);

type Loose = Record<string, unknown>;

interface Section {
  index: number;
  name: string;
  data: Loose;
}

function warn(path: string, code: string, message: string, hint: string): SamenessWarning {
  return { path, code, message, severity: 'warn', hint };
}

function records(value: unknown): Loose[] {
  return Array.isArray(value) ? value.filter((item): item is Loose => item !== null && typeof item === 'object') : [];
}

function graphicsOf(section: Section): Array<{ graphic: Loose; path: string }> {
  return records(section.data.graphics).map((graphic, index) => ({
    graphic,
    path: `sections[${section.index}].graphics[${index}]`,
  }));
}

function fxUntuned(section: Section): SamenessWarning[] {
  return graphicsOf(section).flatMap(({ graphic, path }) => {
    const primitive = FX_PRIMITIVES[graphic.effect as keyof typeof FX_PRIMITIVES] as { params: object } | undefined;

    if (graphic.type !== 'fx' || primitive === undefined) return [];

    const look = [...Object.keys(primitive.params), ...FX_LOOK_FIELDS];

    if (look.some((key) => graphic[key] !== undefined)) return [];

    return [
      warn(
        path,
        'fx_untuned',
        `Section "${section.name}": fx "${String(graphic.effect)}" sets none of its look parameters`,
        `Tune it for this template: ${look.slice(0, 6).join(', ')}, colour ("$color.accent"), duration/ease (get_motion_catalog → fx).`
      ),
    ];
  });
}

// The effect keys a section uses, once each: fx:<effect>, graphic:<type>, kinetic:<preset>, camera:<preset>.
function effectKeys(section: Section): string[] {
  const keys = graphicsOf(section).flatMap(({ graphic }) => {
    if (graphic.type === 'fx') return [`fx "${String(graphic.effect)}"`];

    return DECOR_GRAPHICS.has(String(graphic.type)) ? [`graphic "${String(graphic.type)}"`] : [];
  });
  const kinetic = records(section.data.kinetic).flatMap((block) =>
    typeof block.preset === 'string' ? [`kinetic preset "${block.preset}"`] : []
  );
  const camera = (section.data.camera as Loose | undefined)?.preset;

  return [...new Set([...keys, ...kinetic, ...(typeof camera === 'string' ? [`camera preset "${camera}"`] : [])])];
}

function effectRepeated(sections: Section[]): SamenessWarning[] {
  const uses = new Map<string, Section[]>();

  for (const section of sections) {
    for (const key of effectKeys(section)) uses.set(key, [...(uses.get(key) ?? []), section]);
  }

  return [...uses].flatMap(([key, users]) => {
    if (users.length <= SAME_EFFECT_MAX_SECTIONS || users.length <= sections.length * SAME_EFFECT_MIN_SHARE) return [];

    const first = users.at(SAME_EFFECT_MAX_SECTIONS) as Section;

    return [
      warn(
        `sections[${first.index}]`,
        'effect_repeated',
        `${key} drives ${users.length} of ${sections.length} sections`,
        'Keep it for 1–2 signature beats; give the other sections their own move from the motion intent (another preset, tuned parameters, or none).'
      ),
    ];
  });
}

function sampleHint(sample: LibrarySample | undefined): string {
  const compose = sample ? `: ${sample.composeWith}` : ' (kinetic, animate tracks, camera, graphics, fx)';

  return `Sample asset, prefer composing with the motion engine${compose}.`;
}

function sampleFinding(url: unknown, path: string, where: string): SamenessWarning[] {
  const found = librarySampleOf(url);

  if (found === null) return [];

  const shows = found.sample ? ` (${found.sample.looksLike})` : '';

  return [
    warn(
      path,
      'library_animation_sample',
      `${where} uses the library sample animation "${found.name}"${shows}`,
      sampleHint(found.sample)
    ),
  ];
}

function librarySamples(template: Loose, sections: Section[]): SamenessWarning[] {
  const global = records((template.global as Loose | undefined)?.animations).flatMap((animation, index) =>
    sampleFinding(animation.url, `global.animations[${index}]`, 'A whole-video animation')
  );
  const local = sections.flatMap((section) =>
    records(section.data.inputs).flatMap((input, index) =>
      sampleFinding(input.url, `sections[${section.index}].inputs[${index}]`, `Section "${section.name}"`)
    )
  );

  return [...global, ...local];
}

function decorCount(section: Section): number {
  const graphics = graphicsOf(section).filter(
    ({ graphic }) => graphic.type === 'fx' || DECOR_GRAPHICS.has(String(graphic.type))
  ).length;
  const overlays = records(section.data.inputs).filter((input) => input.type === 'animation').length;

  return graphics + overlays;
}

function decorOverload(section: Section): SamenessWarning[] {
  const count = decorCount(section);

  if (count <= DECOR_MAX_PER_SECTION) return [];

  return [
    warn(
      `sections[${section.index}]`,
      'decor_overload',
      `Section "${section.name}" layers ${count} decorative effects`,
      `One hero effect per beat, at most ${DECOR_MAX_PER_SECTION} layered: keep the one that serves the section's motion intent.`
    ),
  ];
}

type Rgb = [number, number, number];

// Every hex colour of the descriptor, once per use: the template's palette.
function paletteOf(value: unknown, out: Rgb[]): void {
  if (typeof value === 'string') {
    const rgb = parseHexColor(value);

    if (rgb) out.push(rgb);

    return;
  }

  if (value === null || typeof value !== 'object') return;

  for (const child of Object.values(value)) paletteOf(child, out);
}

function coloured(sections: Section[]): Array<{ graphic: Loose; path: string; color: string }> {
  return sections.flatMap((section) =>
    graphicsOf(section).flatMap(({ graphic, path }) => {
      const effect = graphic.type === 'fx' || COLOURED_GRAPHICS.has(String(graphic.type));

      return effect && typeof graphic.color === 'string' ? [{ graphic, path, color: graphic.color.trim() }] : [];
    })
  );
}

// Off the palette: no other use of a near colour anywhere in the template (the effect's own use counts once).
function offPalette(color: string, palette: Rgb[]): boolean {
  const rgb = parseHexColor(color);

  if (rgb === null) return false;

  return (
    palette.filter((other) => other.every((channel, i) => Math.abs(channel - rgb[i]) <= OFF_PALETTE_DELTA)).length <= 1
  );
}

function graphicLabel(graphic: Loose): string {
  return graphic.type === 'fx' ? `fx "${String(graphic.effect)}"` : `graphic "${String(graphic.type)}"`;
}

const OFF_THEME_HINT = {
  themed: 'Use a theme token ("$color.accent", "$color.fg") so the effect follows the theme.',
  free:
    'Take the colour from the template palette (its accent or text colour), or omit it on an fx: its light ' +
    'defaults to a warm white tinted by the theme accent.',
};

function offTheme(template: Loose, sections: Section[]): SamenessWarning[] {
  const effects = coloured(sections);
  const themed = (template.global as Loose | undefined)?.theme !== undefined;
  const palette: Rgb[] = [];

  if (!themed) paletteOf(template, palette);

  return effects.flatMap(({ path, color, graphic }) => {
    if (themed ? color.startsWith('$') : !offPalette(color, palette)) return [];

    const why = themed ? 'is a literal in a themed template' : 'appears nowhere else in the template';

    return [
      warn(
        path,
        'effect_off_theme',
        `${graphicLabel(graphic)} colour ${color} ${why}`,
        themed ? OFF_THEME_HINT.themed : OFF_THEME_HINT.free
      ),
    ];
  });
}

function renderingSections(template: Loose): Section[] {
  return records(template.sections).flatMap((data, index) =>
    RENDERING_SECTION_TYPES.has(String(data.type))
      ? [{ index, name: typeof data.name === 'string' ? data.name : String(index), data }]
      : []
  );
}

/** Every sameness finding for an expanded descriptor. Never throws on odd input. */
export function samenessWarnings(data: unknown): SamenessWarning[] {
  const template = (data ?? {}) as Loose;
  const sections = renderingSections(template);

  return [
    ...sections.flatMap((section) => [...fxUntuned(section), ...decorOverload(section)]),
    ...effectRepeated(sections),
    ...librarySamples(template, sections),
    ...offTheme(template, sections),
  ];
}
