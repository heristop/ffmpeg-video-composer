// Packaged samples for load_sample: the samples module (~300 KB) is imported on first use only, and a
// sample opens in the builder when it is native and holds no effect sections (list_samples `openable`).
import type { SampleDetail } from 'ffmpeg-video-composer/src/samples/types.ts';
import { fail } from './results';
import type { ToolResult } from './types';

/** The sample `id`, or null when there is none. */
export async function loadSample(id: string): Promise<SampleDetail | null> {
  const { getSample } = await import('ffmpeg-video-composer/src/samples.ts');

  try {
    return getSample(id);
  } catch {
    return null;
  }
}

/** Whether the builder can hold a sample (summary or detail). */
export function openable(sample: Pick<SampleDetail, 'backend' | 'requirements'>): boolean {
  return sample.backend === 'native' && sample.requirements.effects.length === 0;
}

/** Why `id` cannot be opened in the builder, or null when it can. */
export async function sampleCheck(id: string): Promise<ToolResult | null> {
  const sample = await loadSample(id);

  if (!sample) return fail('not_found', `No sample ${id}.`, { hint: 'Use list_samples to discover ids.' });

  if (!openable(sample)) {
    return fail('builder_unsupported_section', `${id} uses registered effects the builder cannot hold.`, {
      hint: 'Pick a sample with openable: true.',
    });
  }

  return null;
}
