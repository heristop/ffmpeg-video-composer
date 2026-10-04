import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { EffectRenderResult } from 'ffmpeg-video-composer';
import { renderTitleJob, type TitleJob, type TitleRender } from './registered-render.js';
import { hashFile } from './effect-hashes.js';

const DEFAULT_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 256;
const manifestSchema = z
  .object({
    version: z.literal(1),
    key: z.string(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    metadata: z.object({ duration: z.number().positive() }).catchall(z.json()),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
type CacheState = 'hit' | 'miss' | 'disabled' | 'bypass';

function budget(job: TitleJob) {
  const value = (job.config as { effectCacheMaxBytes?: number }).effectCacheMaxBytes;

  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_BYTES;
}
function keyFor(job: TitleJob, request: TitleRender) {
  let exact: (string | number)[] = ['video'];

  if (request.kind === 'still') exact = ['still', request.frame];

  if (request.kind === 'range') exact = ['range', request.from, request.to];

  return createHash('sha256')
    .update(JSON.stringify([1, job.provenance.hash, exact]))
    .digest('hex');
}
async function safeDirectory(directory: string) {
  const absolute = path.resolve(directory);

  if (!(await fs.lstat(absolute)).isDirectory() || (await fs.realpath(absolute)) !== absolute) {
    throw new Error('Unsafe cache directory');
  }
}
async function cacheRoot(job: TitleJob) {
  const media = await fs.realpath(job.config.mediaDir);
  const base = path.join(media, '.leclap-effects');
  await fs.mkdir(base, { recursive: true });
  await safeDirectory(base);
  const root = path.join(base, 'cache-v1');
  await fs.mkdir(root, { recursive: true });
  await safeDirectory(root);

  return root;
}
async function regularHandle(file: string) {
  // Some platforms do not implement O_NOFOLLOW; reject links before opening too.
  if (!(await fs.lstat(file)).isFile() || (await fs.realpath(file)) !== path.resolve(file)) {
    throw new Error('Non-regular cache artifact');
  }

  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  if (!(await handle.stat()).isFile()) {
    await handle.close();

    throw new Error('Non-regular cache artifact');
  }

  return handle;
}
async function readManifest(entry: string, key: string): Promise<Manifest> {
  await safeDirectory(entry);
  const handle = await regularHandle(path.join(entry, 'manifest.json'));

  try {
    if ((await handle.stat()).size > 65536) throw new Error('Invalid manifest size');
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

    if (bytesRead > 65536) throw new Error('Invalid manifest size');
    const manifest = manifestSchema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));

    if (manifest.key !== key) throw new Error('Invalid cache key');

    return manifest;
  } finally {
    await handle.close();
  }
}
async function privateCopy(source: string, target: string, signal?: AbortSignal) {
  const handle = await regularHandle(source);

  try {
    const output = await fs.open(target, 'wx');

    try {
      await pipeline(handle.createReadStream({ autoClose: false }), output.createWriteStream(), { signal });
    } finally {
      await output.close();
    }
  } finally {
    await handle.close();
  }
}
function assertMetadata(job: TitleJob, request: TitleRender, metadata: EffectRenderResult['metadata']) {
  let frames = job.composition.durationInFrames;

  if (request.kind === 'still') frames = 1;

  if (request.kind === 'range') frames = request.to - request.from + 1;
  const { width, height, fps } = job.composition;

  if (
    Math.abs(metadata.duration - frames / fps) > 1e-6 ||
    metadata.width !== width ||
    metadata.height !== height ||
    metadata.fps !== fps
  ) {
    throw new Error('Inconsistent cache metadata');
  }
}
async function lookup(job: TitleJob, root: string, key: string, request: TitleRender) {
  const entry = path.join(root, key);
  const target = path.join(job.directory, `cached-${randomUUID()}.${request.kind === 'still' ? 'png' : 'mp4'}`);

  try {
    const manifest = await readManifest(entry, key);
    assertMetadata(job, request, manifest.metadata);
    await safeDirectory(job.directory);
    await privateCopy(path.join(entry, 'artifact'), target, job.signal);
    job.signal?.throwIfAborted();

    if ((await fs.stat(target)).size !== manifest.size || (await hashFile(target)).digest('hex') !== manifest.sha256) {
      throw new Error('Corrupt cache artifact');
    }
    job.signal?.throwIfAborted();
    await fs.utimes(entry, new Date(), new Date()).catch(() => {});

    return { path: target, metadata: manifest.metadata, provenance: job.provenance };
  } catch {
    await fs.rm(target, { force: true }).catch(() => {});
    job.signal?.throwIfAborted();
    await fs.rm(entry, { recursive: true, force: true }).catch(() => {});

    return null;
  }
}
async function entryInfo(root: string, name: string) {
  const entry = path.join(root, name);
  const stat = await fs.lstat(entry);

  if (name.startsWith('.stage-') && stat.isDirectory() && stat.mtimeMs < Date.now() - 24 * 60 * 60 * 1000) {
    await fs.rm(entry, { recursive: true, force: true });
  }

  if (!/^[a-f0-9]{64}$/.test(name) || !stat.isDirectory()) return null;
  await safeDirectory(entry);
  const children = await fs.readdir(entry);

  if (children.length !== 2 || !children.includes('artifact') || !children.includes('manifest.json')) {
    throw new Error('Invalid entry files');
  }
  const files = await Promise.all(
    ['artifact', 'manifest.json'].map(async (file) => {
      const item = await fs.lstat(path.join(entry, file));

      if (!item.isFile()) throw new Error('Invalid managed entry');

      return item.size;
    })
  );

  return { entry, bytes: files[0] + files[1], time: stat.mtimeMs };
}
async function managedEntry(root: string, name: string) {
  try {
    return await entryInfo(root, name);
  } catch {
    if (/^[a-f0-9]{64}$/.test(name)) {
      await fs.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {});
    }

    return null;
  }
}
async function prune(root: string, maxBytes: number, reserveBytes = 0, reserveCount = 0) {
  await safeDirectory(root);
  const entries = (await Promise.all((await fs.readdir(root)).map((name) => managedEntry(root, name))))
    .filter((entry) => entry !== null)
    .sort((a, b) => a.time - b.time);
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, reserveBytes);
  let count = entries.length + reserveCount;
  const removals: string[] = [];

  for (const entry of entries) {
    if (bytes <= maxBytes && count <= MAX_ENTRIES) break;
    removals.push(entry.entry);
    bytes -= entry.bytes;
    count -= 1;
  }
  await Promise.all(removals.map((entry) => fs.rm(entry, { recursive: true, force: true })));
}
async function stageResult(job: TitleJob, stage: string, key: string, result: EffectRenderResult) {
  await safeDirectory(path.dirname(result.path));
  const artifact = path.join(stage, 'artifact');
  await privateCopy(result.path, artifact, job.signal);
  const size = (await fs.stat(artifact)).size;
  const manifest = {
    version: 1,
    key,
    size,
    sha256: (await hashFile(artifact)).digest('hex'),
    metadata: result.metadata,
  };
  const serialized = JSON.stringify(manifest);
  manifestSchema.parse(manifest);

  if (Buffer.byteLength(serialized) > 65536) throw new Error('Manifest too large');
  await fs.writeFile(path.join(stage, 'manifest.json'), serialized, { flag: 'wx' });

  return size + Buffer.byteLength(serialized);
}
async function publish(job: TitleJob, root: string, key: string, result: EffectRenderResult, maxBytes: number) {
  const original = await fs.lstat(result.path);

  if (!original.isFile() || original.size > maxBytes) return false;
  await safeDirectory(root);
  const stage = await fs.mkdtemp(path.join(root, '.stage-'));

  try {
    const bytes = await stageResult(job, stage, key, result);

    if (bytes > maxBytes) return false;
    job.signal?.throwIfAborted();
    await prune(root, maxBytes, bytes, 1);
    await fs.rename(stage, path.join(root, key));
    await prune(root, maxBytes);

    return true;
  } finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
function response(result: EffectRenderResult, state: CacheState, writes = 0) {
  return {
    result: { ...result, metadata: { ...result.metadata, cache: state } },
    cache: { hits: Number(state === 'hit'), misses: Number(state === 'miss' || state === 'bypass'), writes },
  };
}
async function optionalRoot(job: TitleJob) {
  try {
    return await cacheRoot(job);
  } catch {
    job.signal?.throwIfAborted();

    return null;
  }
}
async function optionalPublish(
  job: TitleJob,
  root: string,
  key: string,
  result: EffectRenderResult,
  request: TitleRender
) {
  try {
    assertMetadata(job, request, result.metadata);

    return await publish(job, root, key, result, budget(job));
  } catch {
    job.signal?.throwIfAborted();

    return false;
  }
}
async function renderDisabled(job: TitleJob, request: TitleRender, render: typeof renderTitleJob) {
  const result = await render(job, request);
  job.signal?.throwIfAborted();

  return response(result, 'disabled');
}
/** Exact rendered artifacts are copied and verified before reuse; caching errors only reduce reuse. */
export async function renderTitleJobCached(job: TitleJob, request: TitleRender, render = renderTitleJob) {
  job.signal?.throwIfAborted();
  const maxBytes = budget(job);

  if (maxBytes === 0) return renderDisabled(job, request, render);
  const root = await optionalRoot(job);
  const key = keyFor(job, request);
  const hit = root ? await lookup(job, root, key, request) : undefined;

  // Enforce operator budget changes even when this miss cannot be admitted or rendering fails.
  if (root) await prune(root, maxBytes).catch(() => {});
  job.signal?.throwIfAborted();

  if (hit) return response(hit, 'hit');
  const result = await render(job, request);
  job.signal?.throwIfAborted();
  const written = root ? await optionalPublish(job, root, key, result, request) : false;
  job.signal?.throwIfAborted();

  return response(result, written ? 'miss' : 'bypass', Number(written));
}
