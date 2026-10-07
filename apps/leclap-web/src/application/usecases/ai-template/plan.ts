// The creative plan a model writes before the template: who it is for and what it says, three
// concepts with a typicality estimate, the chosen one, and a beat sheet (section, role, verb, copy,
// reason, seconds). Parsed and checked here, by hand, so a malformed plan is repaired or dropped
// before it steers the generation; then rendered as the brief the generation must follow.
import { extractJsonObject } from './extract-json';

export interface PlanConcept {
  concept: string;
  // 0 (nobody would make this) … 1 (what everyone makes for this brief).
  typicality: number;
}

export interface PlanBeat {
  section: string;
  role: string;
  verb: string;
  onScreen: string;
  why: string;
  // The beat's motion intent: engine primitives and how they are tuned (optional; older plans lack it).
  motion?: string;
  seconds: number;
}

export interface TemplatePlan {
  strategy: string;
  concepts: PlanConcept[];
  chosen: number;
  beats: PlanBeat[];
  theme?: string;
  platform?: string;
  transitions: { primary: string; accents: string[] };
  // The one or two signature moves of the whole video.
  signature?: string[];
}

export interface PlanVocabulary {
  themes?: string[];
  platforms?: string[];
}

export type PlanParse = { ok: true; plan: TemplatePlan } | { ok: false; errors: string[] };

export const PLAN_CONCEPTS = 3;
export const PLAN_MIN_BEATS = 2;
export const PLAN_MAX_BEATS = 12;
export const PLAN_MAX_BEAT_SECONDS = 60;
export const PLAN_MAX_SIGNATURE_MOVES = 2;

type Loose = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// "low"/"medium"/"high", 0–1, or a percentage.
function typicality(value: unknown): number | null {
  const words: Record<string, number> = { low: 0.2, medium: 0.5, high: 0.8 };

  if (typeof value === 'string' && Object.hasOwn(words, value.toLowerCase())) return words[value.toLowerCase()];

  const number = typeof value === 'number' ? value : Number.NaN;

  if (!Number.isFinite(number) || number < 0 || number > 100) return null;

  return number > 1 ? number / 100 : number;
}

function parseConcepts(value: unknown, errors: string[]): PlanConcept[] {
  const list = Array.isArray(value) ? value : [];

  if (list.length !== PLAN_CONCEPTS) errors.push(`concepts: give exactly ${String(PLAN_CONCEPTS)} concepts`);

  return list.map((item: unknown, index) => {
    const record = isRecord(item) ? item : { concept: item };
    const concept = text(record.concept);
    const score = typicality(record.typicality);

    if (!concept) errors.push(`concepts[${String(index)}].concept: a one-line concept is required`);

    if (score === null) errors.push(`concepts[${String(index)}].typicality: a number from 0 to 1`);

    return { concept, typicality: score ?? 0.5 };
  });
}

function parseBeat(item: unknown, index: number, errors: string[]): PlanBeat {
  const record = isRecord(item) ? item : {};
  const beat = {
    section: text(record.section),
    role: text(record.role),
    verb: text(record.verb).toUpperCase(),
    onScreen: text(record.onScreen),
    why: text(record.why),
    ...(text(record.motion) && { motion: text(record.motion) }),
    seconds: typeof record.seconds === 'number' ? record.seconds : Number.NaN,
  };
  const at = `beats[${String(index)}]`;

  for (const key of ['section', 'role', 'verb'] as const) {
    if (!beat[key]) errors.push(`${at}.${key}: required`);
  }

  if (!(beat.seconds > 0 && beat.seconds <= PLAN_MAX_BEAT_SECONDS)) {
    errors.push(`${at}.seconds: a number of seconds between 0 and ${String(PLAN_MAX_BEAT_SECONDS)}`);
  }

  return beat;
}

function parseBeats(value: unknown, errors: string[]): PlanBeat[] {
  const list = Array.isArray(value) ? value : [];

  if (list.length < PLAN_MIN_BEATS || list.length > PLAN_MAX_BEATS) {
    errors.push(`beats: between ${String(PLAN_MIN_BEATS)} and ${String(PLAN_MAX_BEATS)} beats`);
  }

  return list.map((item: unknown, index) => parseBeat(item, index, errors));
}

function parseTransitions(value: unknown, errors: string[]): TemplatePlan['transitions'] {
  const record = isRecord(value) ? value : {};
  const primary = text(record.primary);
  const accents = (Array.isArray(record.accents) ? record.accents : []).map(text).filter(Boolean);

  if (!primary) errors.push('transitions.primary: one primary transition type is required');

  if (accents.length > 2) errors.push('transitions.accents: at most 2 accent transitions');

  return { primary, accents };
}

// Optional; a video with more than PLAN_MAX_SIGNATURE_MOVES signatures has none.
function parseSignature(value: unknown, errors: string[]): string[] | undefined {
  const moves = (Array.isArray(value) ? value : []).map(text).filter(Boolean);

  if (moves.length > PLAN_MAX_SIGNATURE_MOVES) {
    errors.push(`signature: at most ${String(PLAN_MAX_SIGNATURE_MOVES)} signature moves for the whole video`);
  }

  return moves.length > 0 ? moves : undefined;
}

function optionalChoice(
  value: unknown,
  field: string,
  known: string[] | undefined,
  errors: string[]
): string | undefined {
  const choice = text(value);

  if (!choice || choice === 'none') return undefined;

  if (known && !known.includes(choice)) errors.push(`${field}: "${choice}" is not one of ${known.join(', ')}`);

  return choice;
}

/** Checks a parsed plan object; every problem is listed so one repair turn can fix them all. */
export function validatePlan(value: Loose, vocabulary: PlanVocabulary = {}): PlanParse {
  const errors: string[] = [];
  const strategy = text(value.strategy);
  const concepts = parseConcepts(value.concepts, errors);
  const chosen = typeof value.chosen === 'number' ? value.chosen : -1;

  if (!strategy) errors.push('strategy: "tells <audience> that <message>" is required');

  if (!Number.isInteger(chosen) || chosen < 0 || chosen >= concepts.length) {
    errors.push('chosen: the 0-based index of the chosen concept');
  }

  const plan: TemplatePlan = {
    strategy,
    concepts,
    chosen,
    beats: parseBeats(value.beats, errors),
    theme: optionalChoice(value.theme, 'theme', vocabulary.themes, errors),
    platform: optionalChoice(value.platform, 'platform', vocabulary.platforms, errors),
    transitions: parseTransitions(value.transitions, errors),
    signature: parseSignature(value.signature, errors),
  };

  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan };
}

export function parsePlan(reply: string, vocabulary: PlanVocabulary = {}): PlanParse {
  const extracted = extractJsonObject(reply);

  return extracted.ok ? validatePlan(extracted.value, vocabulary) : { ok: false, errors: [extracted.error] };
}

export function planSeconds(plan: TemplatePlan): number {
  return plan.beats.reduce((total, beat) => total + beat.seconds, 0);
}

function beatLine(beat: PlanBeat, index: number): string {
  const copy = beat.onScreen ? ` — on screen: "${beat.onScreen}"` : '';
  const why = beat.why ? ` (why: ${beat.why})` : '';
  const motion = beat.motion ? ` — motion: ${beat.motion}` : '';

  return `${String(index + 1)}. section "${beat.section}" [${beat.role}] ${beat.verb} — ${String(beat.seconds)} s${copy}${why}${motion}`;
}

/** The approved plan as instructions for the template call. */
export function formatPlan(plan: TemplatePlan): string {
  const concept = plan.concepts.at(plan.chosen)?.concept ?? '';
  const accents = plan.transitions.accents.length > 0 ? `; accents: ${plan.transitions.accents.join(', ')}` : '';

  return [
    'Follow this approved plan exactly: one section per beat, in this order, with these names, durations, verbs and on-screen copy.',
    `Strategy: ${plan.strategy}`,
    `Concept: ${concept}`,
    ...(plan.theme ? [`Theme: set global.theme to "${plan.theme}" and use its $color / $font tokens.`] : []),
    ...(plan.platform ? [`Platform: set global.platform to "${plan.platform}".`] : []),
    `Transitions: primary ${plan.transitions.primary}${accents} (no other types).`,
    ...(plan.signature
      ? [`Signature moves (the only beats that get the strongest, most tuned effects): ${plan.signature.join('; ')}`]
      : []),
    'Build each beat from its motion intent with engine primitives, tuned for this brief; no library animation overlays.',
    'Beats:',
    ...plan.beats.map(beatLine),
  ].join('\n');
}
