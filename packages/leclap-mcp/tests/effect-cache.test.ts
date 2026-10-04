import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TitleJob, TitleRender } from '../src/effects/registered-render.js';
import { renderTitleJobCached } from '../src/effects/effect-cache.js';
import * as hashes from '../src/effects/effect-hashes.js';
let directory: string;
let job: TitleJob;
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effect-cache-')));
  job = {
    directory,
    composition: { width: 1280, height: 720, fps: 30, durationInFrames: 300 },
    provenance: { hash: 'source' },
    config: { mediaDir: directory },
  } as TitleJob;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});
function renderer() {
  return vi.fn(async (current: TitleJob, request: TitleRender = { kind: 'video' }) => {
    const output = path.join(current.directory, `render-${Math.random()}.png`);
    await fs.writeFile(output, 'pixels');
    let duration = 10;
    if (request.kind === 'still') duration = 1 / 30;
    if (request.kind === 'range') duration = (request.to - request.from + 1) / 30;
    return {
      path: output,
      metadata: {
        duration,
        width: 1280,
        height: 720,
        fps: 30,
      },
      provenance: current.provenance,
    };
  });
}
it('persists immutable artifacts and returns a private verified copy', async () => {
  const render = renderer();
  const first = await renderTitleJobCached(job, { kind: 'still', frame: 0 }, render);
  const second = await renderTitleJobCached(job, { kind: 'still', frame: 0 }, render);
  expect(render).toHaveBeenCalledTimes(1);
  expect(first.cache).toEqual({ hits: 0, misses: 1, writes: 1 });
  expect(second.cache).toEqual({ hits: 1, misses: 0, writes: 0 });
  expect(second.result.path).not.toBe(first.result.path);
  expect(await fs.readFile(second.result.path, 'utf8')).toBe('pixels');
});
it('separates requests and provenance', async () => {
  const render = renderer();
  for (const request of [{ kind: 'video' }, { kind: 'still', frame: 0 }, { kind: 'range', from: 0, to: 1 }] as const) {
    await renderTitleJobCached(job, request, render);
  }
  await renderTitleJobCached({ ...job, provenance: { ...job.provenance, hash: 'changed' } }, { kind: 'video' }, render);
  expect(render).toHaveBeenCalledTimes(4);
});
it('disables caching with zero budget and propagates abort', async () => {
  const render = renderer();
  const disabled = { ...job, config: { ...job.config, effectCacheMaxBytes: 0 } };
  expect((await renderTitleJobCached(disabled, { kind: 'video' }, render)).cache).toEqual({
    hits: 0,
    misses: 0,
    writes: 0,
  });
  const signal = AbortSignal.abort(new Error('cancelled'));
  await expect(renderTitleJobCached({ ...job, signal }, { kind: 'video' }, render)).rejects.toThrow('cancelled');
});
async function cacheEntries() {
  const root = path.join(directory, '.leclap-effects/cache-v1');
  return { root, names: (await fs.readdir(root)).filter((name) => /^[a-f0-9]{64}$/.test(name)) };
}
it.each(['corrupt', 'missing', 'symlink', 'manifest'] as const)('rejects %s cache content', async (damage) => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'video' }, render);
  const { root, names } = await cacheEntries();
  const artifact = path.join(root, names[0], 'artifact');
  if (damage === 'corrupt') await fs.writeFile(artifact, 'broken');
  if (damage === 'manifest') await fs.writeFile(path.join(root, names[0], 'manifest.json'), '{}');
  if (damage === 'missing' || damage === 'symlink') await fs.rm(artifact);
  if (damage === 'symlink') await fs.symlink(path.join(directory, 'outside'), artifact);
  expect((await renderTitleJobCached(job, { kind: 'video' }, render)).cache.hits).toBe(0);
  expect(render).toHaveBeenCalledTimes(2);
});
it('bypasses oversize entries and falls back when cache root is a symlink', async () => {
  const render = renderer();
  const small = { ...job, config: { ...job.config, effectCacheMaxBytes: 1 } };
  expect((await renderTitleJobCached(small, { kind: 'video' }, render)).result.metadata.cache).toBe('bypass');
  const { root, names } = await cacheEntries();
  expect(names).toEqual([]);
  await fs.rm(root, { recursive: true });
  await fs.symlink(directory, root);
  expect((await renderTitleJobCached(job, { kind: 'video' }, render)).cache.writes).toBe(0);
});
it('evicts oldest entries to stay within byte budget', async () => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'still', frame: 0 }, render);
  const { root, names } = await cacheEntries();
  const entry = path.join(root, names[0]);
  const bytes =
    (await fs.stat(path.join(entry, 'artifact'))).size + (await fs.stat(path.join(entry, 'manifest.json'))).size;
  const bounded = { ...job, config: { ...job.config, effectCacheMaxBytes: bytes + 1 } };
  await renderTitleJobCached(bounded, { kind: 'still', frame: 1 }, render);
  expect((await cacheEntries()).names).toHaveLength(1);
  expect((await renderTitleJobCached(bounded, { kind: 'still', frame: 0 }, render)).cache.hits).toBe(0);
});
it('admits only complete immutable entries during concurrent publication', async () => {
  const render = renderer();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => renderTitleJobCached(job, { kind: 'video' }, render))
  );
  expect(results.every((result) => result.cache.hits === 0)).toBe(true);
  expect(results.reduce((sum, result) => sum + result.cache.writes, 0)).toBe(1);
  const { names } = await cacheEntries();
  expect(names).toHaveLength(1);
  expect((await renderTitleJobCached(job, { kind: 'video' }, render)).cache.hits).toBe(1);
});
it('propagates cancellation raised while rendering', async () => {
  const controller = new AbortController();
  const render = renderer();
  const aborting = async (current: TitleJob) => {
    const result = await render(current);
    controller.abort(new Error('during render'));
    return result;
  };
  await expect(
    renderTitleJobCached({ ...job, signal: controller.signal }, { kind: 'video' }, aborting)
  ).rejects.toThrow('during render');
});
it('prunes abandoned staging directories and caps managed entries at 256', async () => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'still', frame: 0 }, render);
  const { root, names } = await cacheEntries();
  const abandoned = path.join(root, '.stage-abandoned');
  await fs.mkdir(abandoned);
  await fs.utimes(abandoned, 0, 0);
  for (let index = 1; index <= 256; index++) {
    await fs.cp(path.join(root, names[0]), path.join(root, index.toString(16).padStart(64, '0')), { recursive: true });
  }
  await renderTitleJobCached(job, { kind: 'still', frame: 1 }, render);
  expect((await cacheEntries()).names).toHaveLength(256);
  await expect(fs.stat(abandoned)).rejects.toThrow();
});
it('keeps private hit usable after lowering budget evicts its cache entry', async () => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'video' }, render);
  const lowered = { ...job, config: { ...job.config, effectCacheMaxBytes: 1 } };
  const hit = await renderTitleJobCached(lowered, { kind: 'video' }, render);
  expect(hit.cache.hits).toBe(1);
  expect(await fs.readFile(hit.result.path, 'utf8')).toBe('pixels');
  expect((await cacheEntries()).names).toEqual([]);
});
it('removes corrupt managed directories including unexpected files', async () => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'video' }, render);
  const { root, names } = await cacheEntries();
  const poisoned = path.join(root, names[0]);
  await fs.writeFile(path.join(poisoned, 'extra'), Buffer.alloc(10000));
  await renderTitleJobCached(job, { kind: 'still', frame: 0 }, render);
  await expect(fs.stat(poisoned)).rejects.toThrow();
});
it('rejects oversized manifest files and regenerates a healthy entry', async () => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'video' }, render);
  const { root, names } = await cacheEntries();
  await fs.writeFile(path.join(root, names[0], 'manifest.json'), Buffer.alloc(70000));
  expect((await renderTitleJobCached(job, { kind: 'video' }, render)).cache.writes).toBe(1);
  expect((await renderTitleJobCached(job, { kind: 'video' }, render)).cache.hits).toBe(1);
});
it('propagates cancellation after a disabled render completes', async () => {
  const controller = new AbortController();
  const render = renderer();
  const aborting = async (current: TitleJob) => {
    const result = await render(current);
    controller.abort(new Error('disabled aborted'));
    return result;
  };
  const disabled = { ...job, signal: controller.signal, config: { ...job.config, effectCacheMaxBytes: 0 } };
  await expect(renderTitleJobCached(disabled, { kind: 'video' }, aborting)).rejects.toThrow('disabled aborted');
});
it('propagates cancellation during hit checksum instead of rendering again', async () => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'video' }, render);
  const controller = new AbortController();
  const hashFile = hashes.hashFile;
  vi.spyOn(hashes, 'hashFile').mockImplementationOnce(async (file, hash) => {
    const result = await hashFile(file, hash);
    controller.abort(new Error('checksum aborted'));
    return result;
  });
  await expect(renderTitleJobCached({ ...job, signal: controller.signal }, { kind: 'video' }, render)).rejects.toThrow(
    'checksum aborted'
  );
  expect(render).toHaveBeenCalledTimes(1);
});
it('retains a copied hit when another caller evicts its entry during checksum', async () => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'video' }, render);
  const { root, names } = await cacheEntries();
  const hashFile = hashes.hashFile;
  vi.spyOn(hashes, 'hashFile').mockImplementationOnce(async (file, hash) => {
    await fs.rm(path.join(root, names[0]), { recursive: true });
    return hashFile(file, hash);
  });
  const hit = await renderTitleJobCached(job, { kind: 'video' }, render);
  expect(hit.cache.hits).toBe(1);
  expect(await fs.readFile(hit.result.path, 'utf8')).toBe('pixels');
});
it.skipIf(process.platform === 'win32')('rejects FIFO artifacts without blocking lookup', async () => {
  const render = renderer();
  await renderTitleJobCached(job, { kind: 'video' }, render);
  const { root, names } = await cacheEntries();
  const artifact = path.join(root, names[0], 'artifact');
  await fs.rm(artifact);
  await promisify(execFile)('mkfifo', [artifact]);
  expect((await renderTitleJobCached(job, { kind: 'video' }, render)).cache.hits).toBe(0);
  expect(render).toHaveBeenCalledTimes(2);
});
it('reuses artifacts in a fresh job directory without exposing cache-owned paths', async () => {
  const render = renderer();
  const first = await renderTitleJobCached(job, { kind: 'video' }, render);
  const freshDirectory = await fs.mkdtemp(path.join(directory, 'new-job-'));
  const hit = await renderTitleJobCached({ ...job, directory: freshDirectory }, { kind: 'video' }, render);
  expect(hit.cache.hits).toBe(1);
  expect(path.dirname(hit.result.path)).toBe(freshDirectory);
  expect(hit.result.provenance).toEqual(first.result.provenance);
  await fs.rm(path.join(directory, '.leclap-effects'), { recursive: true });
  expect(await fs.readFile(hit.result.path, 'utf8')).toBe('pixels');
});
it('propagates renderer errors exactly once', async () => {
  const render = vi.fn(async () => {
    throw new Error('renderer failed');
  });
  await expect(renderTitleJobCached(job, { kind: 'video' }, render)).rejects.toThrow('renderer failed');
  expect(render).toHaveBeenCalledTimes(1);
});
it.each(['duration', 'width', 'height', 'fps'] as const)(
  'rejects corrupted valid-shaped %s metadata',
  async (field) => {
    const render = renderer();
    await renderTitleJobCached(job, { kind: 'video' }, render);
    const { root, names } = await cacheEntries();
    const manifestPath = path.join(root, names[0], 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.metadata[field] += 1;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const repaired = await renderTitleJobCached(job, { kind: 'video' }, render);
    expect(repaired.cache.hits).toBe(0);
    expect(repaired.cache.writes).toBe(1);
    expect(repaired.result.metadata.duration).toBe(10);
    expect(render).toHaveBeenCalledTimes(2);
  }
);
it('bypasses publication of renderer metadata inconsistent with the prepared request', async () => {
  const render = renderer();
  const inconsistent = async (current: TitleJob, request: TitleRender) => {
    const result = await render(current, request);
    return { ...result, metadata: { ...result.metadata, duration: 11 } };
  };
  expect((await renderTitleJobCached(job, { kind: 'video' }, inconsistent)).cache.writes).toBe(0);
  expect((await cacheEntries()).names).toEqual([]);
});

it('rejects symlink artifacts even when the platform does not enforce O_NOFOLLOW', async () => {
  const { constants } = await import('node:fs');
  const render = renderer();
  const first = await renderTitleJobCached(job, { kind: 'still', frame: 0 }, render);
  const { root, names } = await cacheEntries();
  const artifact = path.join(root, names[0], 'artifact');
  await fs.rm(artifact);
  await fs.symlink(first.result.path, artifact);
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation((file, flags, mode) =>
    open(file, typeof flags === 'number' ? flags & ~constants.O_NOFOLLOW : flags, mode)
  );
  const result = await renderTitleJobCached(job, { kind: 'still', frame: 0 }, render);
  expect(result.cache.hits).toBe(0);
  expect(render).toHaveBeenCalledTimes(2);
});

it.each([1, 6])(
  'enforces a lowered positive budget on a miss even when admission bypasses (%i bytes)',
  async (maxBytes) => {
    const render = renderer();
    await renderTitleJobCached(job, { kind: 'video' }, render);
    const changed = {
      ...job,
      provenance: { ...job.provenance, hash: 'changed' },
      config: { ...job.config, effectCacheMaxBytes: maxBytes },
    };
    const result = await renderTitleJobCached(changed, { kind: 'video' }, render);
    expect(result.cache).toEqual({ hits: 0, misses: 1, writes: 0 });
    expect(await fs.readFile(result.result.path, 'utf8')).toBe('pixels');
    expect((await cacheEntries()).names).toEqual([]);
    expect(render).toHaveBeenCalledTimes(2);
  }
);

it('enforces a lowered positive budget even when rendering the miss fails', async () => {
  await renderTitleJobCached(job, { kind: 'video' }, renderer());
  const changed = {
    ...job,
    provenance: { ...job.provenance, hash: 'changed' },
    config: { ...job.config, effectCacheMaxBytes: 1 },
  };
  await expect(
    renderTitleJobCached(changed, { kind: 'video' }, async () => {
      throw new Error('render failed');
    })
  ).rejects.toThrow('render failed');
  expect((await cacheEntries()).names).toEqual([]);
});
