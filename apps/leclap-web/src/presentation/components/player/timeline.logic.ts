// The player's timeline and title card, as plain functions: where a template's scenes start on the bar, what to
// call the video's frame, how big the frame preview is, how often it seeks, and which way the speed chip rolls.

interface SceneLike {
  options?: { duration?: unknown };
  transition?: unknown;
}

const seconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const transitionLength = (transition: unknown): number => {
  if (typeof transition !== 'object' || transition === null || !('duration' in transition)) return 0;

  return seconds(transition.duration) ?? 0;
};

/**
 * Where each scene after the first starts, in the template's own seconds. A scene starts where the last one ends,
 * less the transition that overlaps the two (as the engine assembles them). A scene without a fixed length (its
 * clip decides it) makes the timeline unknowable, so then there are no markers at all.
 */
export function sceneMarkers(sections: readonly SceneLike[]): number[] {
  const markers: number[] = [];
  let start = 0;

  for (const [index, section] of sections.entries()) {
    const length = seconds(section.options?.duration);

    if (length === null) return [];

    start += length - transitionLength(section.transition);

    if (index < sections.length - 1) markers.push(Math.round(start * 1000) / 1000);
  }

  return markers;
}

/** The template's own length: where its last scene ends. Zero when a scene has no fixed length. */
export function timelineLength(sections: readonly SceneLike[]): number {
  const last = sections.at(-1);
  const lastLength = seconds(last?.options?.duration);
  const markers = sceneMarkers(sections);

  if (!last || lastLength === null || (sections.length > 1 && markers.length === 0)) return 0;

  return (markers.at(-1) ?? 0) + lastLength;
}

const EDGE = 0.005;

/**
 * The markers as fractions of the bar. They are scaled from the template's length to the video's real one (an
 * encoder pads or trims a few frames), and any that would sit on either end are dropped.
 */
export function markerFractions(markers: readonly number[], templateLength: number, videoLength: number): number[] {
  if (!(templateLength > 0) || !(videoLength > 0)) return [];

  return markers.map((marker) => marker / templateLength).filter((share) => share > EDGE && share < 1 - EDGE);
}

/** The timeline's scene notches for a video, given its template's scenes (or none), once its length is known. */
export function sceneShares(
  scenes: { markers: readonly number[]; length: number } | null | undefined,
  videoLength: number
): number[] {
  if (!scenes) return [];

  return markerFractions(scenes.markers, scenes.length, videoLength);
}

const FRAMES: Array<[string, number]> = [
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
];

const TOLERANCE = 0.02;

/** "16:9", "9:16", "1:1", "4:5"…, or "1.85:1" for any other frame; empty while the size is unknown. */
export function aspectLabel(width: number, height: number): string {
  if (!(width > 0) || !(height > 0)) return '';

  const ratio = width / height;
  const named = FRAMES.find(([, value]) => Math.abs(value - ratio) / value < TOLERANCE);

  if (named) return named[0];

  return `${Math.round(ratio * 100) / 100}:1`;
}

/** The frame preview's size: the video's shape, its longer edge `edge` px; landscape until the size is known. */
export function previewSize(width: number, height: number, edge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: edge, height: Math.round((edge * 9) / 16) };

  if (width >= height) return { width: edge, height: Math.round((edge * height) / width) };

  return { width: Math.round((edge * width) / height), height: edge };
}

/** A hover time snapped down to `step`, so sweeping the bar seeks the preview a handful of times, not hundreds. */
export function quantizeTime(time: number, step: number): number {
  if (!(time > 0)) return 0;

  return Math.floor(time / step) * step;
}

/** Which way the speed chip's figure rolls as the speed changes. */
export function rateRoll(previous: number, next: number): 'up' | 'down' | 'none' {
  if (next > previous) return 'up';

  if (next < previous) return 'down';

  return 'none';
}
