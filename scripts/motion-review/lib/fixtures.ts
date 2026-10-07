import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sanitize } from './sanitize.ts';
import { applyTokens, baseSection, DEFAULT_SUBJECT, sceneDescriptor, sceneTokens, type SubjectSpec } from './scene.ts';
import {
  BACKGROUNDS,
  FORMATS,
  type Background,
  type Format,
  type Json,
  type JsonObject,
  type RenderJob,
  type ReviewOptions,
} from './types.ts';

// Effect fixtures: one JSON per library effect in fixtures/. Each fixture contributes a section
// fragment (inputs, graphics, kinetic, filters…) that the harness lays over every background × format
// with the {{tokens}} resolved. See ../README.md for the format.

export interface Fixture {
  id: string;
  label: string;
  /** `legacy` (APNG input), `graphic` (existing graphics[]), `kinetic`, `fx` (graphics[].type "fx"). */
  kind: string;
  /** The effect's life in section seconds; the six sheet moments are derived from it. */
  window: { at: number; duration: number };
  /** Optional explicit moments: section seconds, or "35%" of the window. */
  moments?: (number | string)[];
  backgrounds?: Background[];
  formats?: Format[];
  subject?: Partial<SubjectSpec>;
  /** Seconds the section holds after the window (default 0.8). */
  hold?: number;
  /** Merged into the stage descriptor's `global` (e.g. `{ "motion": { "reduced": true } }`). */
  global?: JsonObject;
  section: JsonObject;
  /** A second stage section after the first (for transitions): this fragment over the same background. */
  next?: JsonObject;
}

const DEFAULT_FRACTIONS = [0.2, 0.4, 0.6, 0.8];

function readFixture(file: string): Fixture {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Fixture>;
  const id = raw.id ?? path.basename(file, '.json');

  if (!raw.window || typeof raw.window.at !== 'number' || typeof raw.window.duration !== 'number') {
    throw new Error(`fixture ${id}: "window": { "at", "duration" } (seconds) is required`);
  }

  if (!raw.section || typeof raw.section !== 'object') throw new Error(`fixture ${id}: "section" is required`);

  return { ...raw, id, label: raw.label ?? id, kind: raw.kind ?? 'fx' } as Fixture;
}

export function loadFixtures(dir: string): Fixture[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => readFixture(path.join(dir, file)));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Six moments: just before, 20/40/60/80 % through, and just after the window (or the fixture's own). */
export function fixtureMoments(fixture: Fixture): number[] {
  const { at, duration } = fixture.window;
  const fromFraction = (value: number | string): number =>
    typeof value === 'number' ? value : at + (duration * Number.parseFloat(value)) / 100;
  const moments = fixture.moments?.map(fromFraction) ?? [
    Math.max(0, at - 0.05),
    ...DEFAULT_FRACTIONS.map((fraction) => at + duration * fraction),
    at + duration + 0.05,
  ];

  return moments.map(round);
}

function mergeSection(base: JsonObject, fragment: JsonObject): JsonObject {
  const out: JsonObject = { ...base };

  for (const [key, value] of Object.entries(fragment)) {
    const current = out[key];

    out[key] = Array.isArray(current) && Array.isArray(value) ? [...current, ...value] : mergeValue(current, value);
  }

  return out;
}

function mergeValue(current: Json | undefined, value: Json): Json {
  const bothObjects = typeof current === 'object' && current !== null && typeof value === 'object' && value !== null;

  if (!bothObjects || Array.isArray(value) || Array.isArray(current)) return value;

  return mergeSection(current, value);
}

function fixtureJob(fixture: Fixture, background: Background, format: Format, options: ReviewOptions): RenderJob {
  const subject = { ...DEFAULT_SUBJECT, ...fixture.subject };
  const tokens = sceneTokens(format, subject, fixture.window);
  const duration = round(Math.max(2, fixture.window.at + fixture.window.duration + (fixture.hold ?? 0.8)));
  const fragment = applyTokens(fixture.section, tokens) as JsonObject;
  const section = mergeSection(baseSection(background, format, tokens, duration), fragment);
  const next = fixture.next && {
    ...mergeSection(baseSection(background, format, tokens, duration), applyTokens(fixture.next, tokens) as JsonObject),
    name: 'review-next',
  };
  const key = `${fixture.id}__${background}__${format}`;
  const sections = next ? [section, next] : section;
  const clean = sanitize(sceneDescriptor(format, sections, key, fixture.global), options.assets, format);
  const effectGone = fixture.kind === 'legacy' && clean.dropped.length > 0;

  return {
    key,
    group: 'effect',
    title: `${fixture.label} · ${background} · ${format}`,
    kind: fixture.kind,
    descriptor: clean.descriptor,
    at: fixtureMoments(fixture),
    args: [],
    notes: clean.notes.filter((note) => note !== 'music off'),
    ...(effectGone && { skip: 'pointer, not rendered' }),
  };
}

function wanted<T extends string>(all: readonly T[], fixture: T[] | undefined, filter: readonly T[]): T[] {
  return (fixture ?? [...all]).filter((item) => filter.includes(item));
}

/** Every effect job: fixture × background × format, after the --only/--formats/--backgrounds filters. */
export function effectJobs(fixtures: Fixture[], options: ReviewOptions): RenderJob[] {
  return fixtures.flatMap((fixture) =>
    wanted(BACKGROUNDS, fixture.backgrounds, options.backgrounds).flatMap((background) =>
      wanted(FORMATS, fixture.formats, options.formats).map((format) =>
        fixtureJob(fixture, background, format, options)
      )
    )
  );
}
