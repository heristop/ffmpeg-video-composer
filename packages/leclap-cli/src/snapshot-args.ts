import os from 'node:os';
import path from 'node:path';
import type { SnapshotTime, SnapshotZoom, VideoTimeline } from 'ffmpeg-video-composer';
import { collectRepeated } from './render-args.js';

// Pure parsing and formatting for `leclap snapshot`, `leclap compare` and `leclap timeline`, kept out of
// the commands so they are unit-testable without the engine.

const NUMBER = /^\d+(?:\.\d+)?$/;

/** `--at 1.5,intro.end --at beat:8` → [1.5, 'intro.end', 'beat:8']: plain seconds become numbers. */
export function parseAtList(values: readonly string[]): SnapshotTime[] {
  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map((value) => (NUMBER.test(value) ? Number(value) : value));
}

/** Every `--at` value: repeated flags from raw argv, or the parsed one for programmatic callers. */
export function atValues(rawArgs: readonly string[] | undefined, parsed: unknown): SnapshotTime[] {
  const values = rawArgs ? collectRepeated(rawArgs, 'at') : [parsed].flat();

  return parseAtList(values.filter((value): value is string => typeof value === 'string'));
}

/** `--zoom x,y,w,h` (fractions of the frame, or pixels) → a zoom region; throws on anything else. */
export function parseZoom(text: string | undefined): SnapshotZoom | undefined {
  if (text === undefined) return undefined;

  const values = text.split(',').map((value) => Number(value.trim()));

  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`--zoom expects x,y,w,h (fractions 0..1 or pixels), got "${text}"`);
  }

  const [x, y, w, h] = values;

  return { x, y, w, h };
}

/** The section render cache snapshots reuse between runs when `--cache` is not given. */
export function defaultCacheDir(): string {
  return path.join(os.tmpdir(), 'leclap-section-cache');
}

function seconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

/** The timeline as a human report: one line per section, its events indented beneath it. */
export function formatTimeline(timeline: VideoTimeline): string[] {
  const head = `${timeline.width}×${timeline.height} @ ${timeline.fps} fps · ${seconds(timeline.duration)}${timeline.approx ? ' (approx: a clip length is assumed)' : ''}`;

  return [
    head,
    ...timeline.sections.flatMap((section) => [
      `${seconds(section.start)} – ${seconds(section.end)}  ${section.name} (${section.type})${section.transition ? ` → ${section.transition.type} ${section.transition.duration}s` : ''}`,
      ...timeline.events
        .filter((event) => event.section === section.name && event.kind !== 'transition')
        .map(
          (event) =>
            `    ${seconds(event.start)} – ${seconds(event.end)}  ${event.kind} ${event.id ?? event.element}${event.preset ? ` ${event.preset}` : ''}`
        ),
    ]),
    ...(timeline.cues.length > 0
      ? [`cues: ${timeline.cues.map((cue) => `${cue.name}@${seconds(cue.time)}`).join(', ')}`]
      : []),
    ...(timeline.beats.length > 0
      ? [`beats: ${timeline.beats.length} (first ${seconds(timeline.beats[0].time)})`]
      : []),
  ];
}
