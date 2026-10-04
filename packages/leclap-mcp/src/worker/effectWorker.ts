import { prepareTitleJob, type TitleRender } from '../effects/registered-render.js';
import type { PreparedTitle } from '../effects/title-registry.js';
import type { McpConfig } from '../config.js';
import type { EffectRenderResult } from 'ffmpeg-video-composer';
import { renderTitleJobCached } from '../effects/effect-cache.js';
import { ownEffectProcesses } from '../effects/effect-processes.js';
const cleanupProcesses = ownEffectProcesses((ownedProcess) => {
  if (process.connected) process.send?.({ ownedProcess }, () => {});
});
process.on('exit', cleanupProcesses);
process.on('disconnect', () => {
  cleanupProcesses();
  process.exit(1);
});
const controller = new AbortController();
process.on('SIGTERM', () => {
  cleanupProcesses();
  controller.abort();
});
type Message = {
  cancel?: boolean;
  title: PreparedTitle;
  config: McpConfig;
  requests: TitleRender[];
  directory: string;
};
async function handleMessage(message: Message) {
  if (message.cancel) {
    cleanupProcesses();
    controller.abort();

    return;
  }

  try {
    const job = await prepareTitleJob(message.title, message.config, controller.signal, message.directory);
    const cache = { hits: 0, misses: 0, writes: 0 };
    // Render serially to bound Chromium/encoder concurrency to one per worker.
    const results = await message.requests.reduce(async (pending, request) => {
      const rendered = await pending;
      const output = await renderTitleJobCached(job, request);
      rendered.push(output.result);
      cache.hits += output.cache.hits;
      cache.misses += output.cache.misses;
      cache.writes += output.cache.writes;

      return rendered;
    }, Promise.resolve<EffectRenderResult[]>([]));
    process.send?.({ ok: true, results, provenance: job.provenance, cache }, () => process.exit(0));
  } catch (error) {
    process.send?.({ ok: false, error: error instanceof Error ? error.message : String(error) }, () => process.exit(1));
  }
}
process.on('message', (message: Message) => {
  handleMessage(message).catch(() => process.exit(1));
});
