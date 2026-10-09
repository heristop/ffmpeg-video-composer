import { SHOWCASE_SAMPLES, type ShowcaseSample } from './catalog';

// A sample opens in a dialog over the library, addressed by `?sample=<id>` so the link can be shared.
export const SAMPLE_PARAM = 'sample';

// The history entry a card pushes carries this flag, so closing that dialog steps back instead of
// stacking another entry; a dialog reached by a link has no such entry and closes in place.
const OPENED_HERE = 'showcaseSampleOpened';

export type DialogState = { [OPENED_HERE]: true };

export const OPENED_STATE: DialogState = { [OPENED_HERE]: true };

/** The sample the URL opens, if it names one the catalog has. */
export function dialogSample(params: URLSearchParams): ShowcaseSample | undefined {
  const id = params.get(SAMPLE_PARAM);

  return SHOWCASE_SAMPLES.find((sample) => sample.id === id);
}

export function withSample(params: URLSearchParams, id: string): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(SAMPLE_PARAM, id);

  return next;
}

export function withoutSample(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(SAMPLE_PARAM);

  return next;
}

/** How a dialog closes: back over the entry its card pushed, or by replacing the linked URL. */
export function closeRoute(state: unknown): 'back' | 'replace' {
  const opened = typeof state === 'object' && state !== null && OPENED_HERE in state;

  return opened ? 'back' : 'replace';
}

/** The card a sample's dialog hands focus back to. */
export function tileSelector(id: string): string {
  return `[data-sample-tile="${id.replaceAll(/["\\]/g, String.raw`\$&`)}"]`;
}
