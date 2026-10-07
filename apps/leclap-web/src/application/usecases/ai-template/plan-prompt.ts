// The planning call's prompt: the same art direction, story spine and lazy-defaults list as the
// template call, plus only the vocabulary a beat sheet needs (verbs, transitions, themes, platforms,
// the genre doctrine). No schema and no samples, so the call stays small and quick.
import { artDirection, COMPOSE_MOTION, LAZY_DEFAULTS, STORY_SPINE } from './art-direction';
import type { EngineCatalog } from './engine-catalog';
import { PLAN_CONCEPTS, PLAN_MAX_BEATS, type PlanVocabulary } from './plan';
import { referenceBlock, type GenerationHints } from './system-prompt';

const PLAN_CONTRACT = [
  'You are the creative director planning a LeClap video template. Do not write the template yet.',
  'Reply with exactly ONE JSON object, no prose and no fences, of this shape:',
  '{"strategy":"tells <audience> that <message>",' +
    '"concepts":[{"concept":"<one line>","typicality":0.8},{"concept":"…","typicality":0.4},{"concept":"…","typicality":0.2}],' +
    '"chosen":1,' +
    '"beats":[{"section":"hook","role":"hook","verb":"SLAMS","onScreen":"<exact copy>","why":"<one clause>","motion":"<motion intent: engine primitives + their tuning>","seconds":1.5}],' +
    '"signature":["<the one or two signature moves of the whole video>"],' +
    '"theme":"<theme name or none>","platform":"<platform id or none>",' +
    '"transitions":{"primary":"<transition>","accents":["<transition>"]}}',
  `- concepts: exactly ${String(PLAN_CONCEPTS)} one-line concepts. typicality is 0–1: how likely another designer would make the same thing for this brief.`,
  '- chosen: the 0-based index. Prefer an atypical concept (lowest typicality that still serves the brief) unless the brief is conservative (corporate, legal, medical, tutorial), then pick the clearest.',
  `- beats: 2–${String(PLAN_MAX_BEATS)} beats, one per section. section is a short unique slug; role is hook, problem, product-intro, proof, cta, outro or footage; verb is a motion-catalog verb in capitals; onScreen is the exact copy (empty for footage); seconds per beat.`,
  '- transitions: one primary plus at most 2 accents, from the transition list.',
  '- motion: per beat, the motion intent derived from the creative direction, named as engine primitives with their tuning ("price SLAMS: impact on $snappy, a twin fx sheen crosses the card at 0.5 s"), never a library animation.',
  '- signature: 1 or 2 signature moves for the whole video; the other beats stay simpler so these land.',
].join('\n');

// Every catalog verb with the primitive that performs it ("SLAMS (impact)").
export function verbList(catalog: EngineCatalog): string {
  const { motion } = catalog;
  const entries = [
    ...motion.kinetic.presets.map((entry) => `${entry.verb} (${entry.preset})`),
    ...motion.camera.presets.map((entry) => `${entry.verb} (camera ${entry.preset})`),
    ...Object.entries(motion.graphics).map(([name, entry]) => `${entry.verb} (graphic ${name})`),
  ];

  return [...new Set(entries)].join(', ');
}

export function planVocabulary(catalog: EngineCatalog): PlanVocabulary {
  return {
    themes: (catalog.themes ?? []).map((theme) => theme.id),
    platforms: catalog.motion.platforms.map((platform) => platform.id),
  };
}

function vocabularyBlock(catalog: EngineCatalog, genre: string | undefined): string {
  const vocabulary = planVocabulary(catalog);
  const doctrines: Record<string, unknown> = catalog.motion.doctrine;
  const doctrine = genre && Object.hasOwn(doctrines, genre) ? doctrines[genre] : undefined;

  return [
    `Verbs: ${verbList(catalog)}`,
    `Transitions: ${Object.keys(catalog.motion.transitions).join(', ')}`,
    `Themes: ${(catalog.themes ?? []).map((theme) => `${theme.id} (${theme.description ?? ''})`).join('; ')}`,
    `Platforms: ${(vocabulary.platforms ?? []).join(', ')}`,
    ...(doctrine === undefined ? [] : [`Genre doctrine (${String(genre)}): ${JSON.stringify(doctrine)}`]),
  ].join('\n');
}

export function buildPlanPrompt(catalog: EngineCatalog, hints: GenerationHints, referenceStyle?: string): string {
  return [
    PLAN_CONTRACT,
    artDirection(hints),
    STORY_SPINE,
    COMPOSE_MOTION,
    LAZY_DEFAULTS,
    `Vocabulary:\n${vocabularyBlock(catalog, hints.genre)}`,
    // An attached reference fixes the theme: the plan's "theme" stays "none" and its pacing follows it.
    ...referenceBlock(referenceStyle),
  ].join('\n\n');
}

export function planRepairMessage(errors: string[]): string {
  return [
    'That plan does not validate. Fix every issue below and reply with the complete corrected plan JSON only.',
    errors.map((error) => `- ${error}`).join('\n'),
  ].join('\n\n');
}
