import fs from 'node:fs/promises';
import { resolveTemplateEffects } from 'ffmpeg-video-composer';
import type { McpConfig } from '../config.js';
import { validateEffects } from './title-registry.js';
import { runTitleEffect } from './effect-runner.js';

export async function resolveComposeEffects(
  template: Record<string, unknown>,
  config: McpConfig,
  paths: Record<string, string>,
  signal?: AbortSignal
) {
  const directories: string[] = [];
  const effectCache = { hits: 0, misses: 0, writes: 0 };

  try {
    const prepared = await validateEffects(template, config, signal);
    const effects = await resolveTemplateEffects(
      template,
      async (section) => {
        const title = prepared.get(section.name);

        if (!title) throw new Error(`effect_not_preflighted: ${section.name}`);
        const job = await runTitleEffect(title, config, [{ kind: 'video' }], signal);
        directories.push(job.directory);
        effectCache.hits += job.cache?.hits ?? 0;
        effectCache.misses += job.cache?.misses ?? 0;
        effectCache.writes += job.cache?.writes ?? 0;

        return job.results[0];
      },
      {
        preflight: (section) => {
          if (!prepared.has(section.name)) throw new Error(`effect_not_preflighted: ${section.name}`);
        },
      }
    );

    return {
      ok: true as const,
      descriptor: effects.descriptor,
      paths: { ...paths, ...effects.userVideoPaths },
      effectProvenance: effects.provenance,
      effectCache,
      effectDirectories: directories,
    };
  } catch (error) {
    await Promise.all(
      directories.map((directory) => fs.rm(directory, { recursive: true, force: true }).catch(() => {}))
    );

    throw error;
  }
}
