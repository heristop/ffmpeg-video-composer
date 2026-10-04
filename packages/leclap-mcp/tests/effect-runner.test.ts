import { ChildProcess } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let child: ChildProcess;
let sent: any;
let root: string;
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  fork: () => child,
}));
import { runTitleEffect } from '../src/effects/effect-runner.js';
beforeEach(async () => {
  sent = undefined;
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-effect-runner-test-')));
  child = new ChildProcess();
  Object.assign(child, {
    pid: 424242,
    send: (job: any, cb: any) => {
      sent = job;
      cb?.(null);
      return true;
    },
    kill: (signal: any) => {
      queueMicrotask(() => {
        Object.assign(child, { exitCode: null, signalCode: signal });
        child.emit('exit', null, signal);
      });
      return true;
    },
  });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it('waits for worker exit before cleaning a canceled bundle job', async () => {
  const pending = runTitleEffect({} as never, { mediaDir: root, renderTimeoutMs: 15 } as never, [{ kind: 'video' }]);
  await expect(pending).rejects.toThrow(/timed out/);
  expect(await fs.readdir(path.join(root, '.leclap-effects'))).toEqual([]);
});
it('keeps provenance/output directory after acknowledged successful rendering', async () => {
  const pending = runTitleEffect({} as never, { mediaDir: root, renderTimeoutMs: 1000 } as never, [{ kind: 'video' }]);
  await vi.waitFor(() => expect(sent?.directory).toBeTypeOf('string'));
  child.emit('message', {
    ok: true,
    results: [{ path: path.join(sent.directory, 'clip.mp4'), metadata: { duration: 10 } }],
    provenance: { hash: 'trusted' },
  });
  Object.assign(child, { exitCode: 0 });
  child.emit('exit', 0, null);
  const result = await pending;
  expect(result.cache).toEqual({ hits: 0, misses: 0, writes: 0 });
  expect(result.provenance.hash).toBe('trusted');
  expect((await fs.stat(result.directory)).isDirectory()).toBe(true);
});
it('hard kills a worker that ignores termination and then cleans its directory', async () => {
  const signals: string[] = [];
  Object.assign(child, {
    kill: (signal: string) => {
      signals.push(signal);
      if (signal === 'SIGKILL') queueMicrotask(() => child.emit('exit', null, signal));
      return true;
    },
  });
  await expect(
    runTitleEffect({} as never, { mediaDir: root, renderTimeoutMs: 10 } as never, [{ kind: 'video' }])
  ).rejects.toThrow(/timed out/);
  expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  expect(await fs.readdir(path.join(root, '.leclap-effects'))).toEqual([]);
});
it('abort terminates a running worker before cleanup', async () => {
  const controller = new AbortController();
  const pending = runTitleEffect(
    {} as never,
    { mediaDir: root, renderTimeoutMs: 1000 } as never,
    [{ kind: 'video' }],
    controller.signal
  );
  await vi.waitFor(() => expect(sent?.directory).toBeTypeOf('string'));
  controller.abort();
  await expect(pending).rejects.toThrow(/aborted/);
  expect(await fs.readdir(path.join(root, '.leclap-effects'))).toEqual([]);
});

it('retains cache diagnostics from IPC', async () => {
  const pending = runTitleEffect({} as never, { mediaDir: root, renderTimeoutMs: 1000 } as never, [{ kind: 'video' }]);
  await vi.waitFor(() => expect(sent?.directory).toBeTypeOf('string'));
  child.emit('message', {
    ok: true,
    results: [],
    provenance: { hash: 'cached' },
    cache: { hits: 2, misses: 1, writes: 1 },
  });
  child.emit('exit', 0, null);
  expect((await pending).cache).toEqual({ hits: 2, misses: 1, writes: 1 });
});

it('holds the permit until exit and releases it after worker failure', async () => {
  const first = runTitleEffect({} as never, { mediaDir: root, renderTimeoutMs: 1000 } as never, [{ kind: 'video' }]);
  await vi.waitFor(() => expect(sent?.directory).toBeTypeOf('string'));
  const firstDirectory = sent.directory;
  const controller = new AbortController();
  const queued = runTitleEffect(
    {} as never,
    { mediaDir: root, renderTimeoutMs: 1000 } as never,
    [{ kind: 'video' }],
    controller.signal
  );
  controller.abort();
  await expect(queued).rejects.toThrow(/aborted/);
  expect(sent.directory).toBe(firstDirectory);
  child.emit('exit', 1, null);
  await expect(first).rejects.toThrow(/without a result/);
  sent = undefined;
  const next = runTitleEffect({} as never, { mediaDir: root, renderTimeoutMs: 1000 } as never, [{ kind: 'video' }]);
  await vi.waitFor(() => expect(sent?.directory).toBeTypeOf('string'));
  child.emit('message', { ok: true, results: [], provenance: { hash: 'next' } });
  child.emit('exit', 0, null);
  await expect(next).resolves.toHaveProperty('provenance.hash', 'next');
});

it.skipIf(process.platform === 'win32').each(['timeout', 'abort'])(
  'terminates an announced detached browser on %s before releasing the worker',
  async (mode) => {
    const kills = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const controller = new AbortController();
    try {
      const pending = runTitleEffect(
        {} as never,
        { mediaDir: root, renderTimeoutMs: 200 } as never,
        [{ kind: 'video' }],
        controller.signal
      );
      await vi.waitFor(() => expect(sent?.directory).toBeTypeOf('string'));
      child.emit('message', { ownedProcess: { pid: 424243, detached: true } });
      if (mode === 'abort') controller.abort();
      await vi.waitFor(() => expect(kills).toHaveBeenCalledWith(-424242, 'SIGTERM'));
      child.emit('exit', null, 'SIGTERM');
      await expect(pending).rejects.toThrow(mode === 'abort' ? /aborted/ : /timed out/);
      expect(kills).toHaveBeenCalledWith(-424243, 'SIGKILL');
      expect(await fs.readdir(path.join(root, '.leclap-effects'))).toEqual([]);
    } finally {
      kills.mockRestore();
    }
  }
);

it('passes resolved JSON metadata to the worker without its catalog snapshot or path', async () => {
  const title = {
    compositionId: 'LeclapProductReveal',
    definitionHash: 'a'.repeat(64),
    props: { headline: 'Product' },
    assets: {},
  };
  const pending = runTitleEffect(
    title as never,
    {
      mediaDir: root,
      renderTimeoutMs: 1000,
      effectCatalogPath: '/deleted/catalog.json',
      effectCatalog: { schemaVersion: 1, effects: [] },
    } as never,
    [{ kind: 'video' }]
  );
  await vi.waitFor(() => expect(sent?.directory).toBeTypeOf('string'));
  const payload = JSON.parse(JSON.stringify(sent));
  child.emit('message', { ok: true, results: [], provenance: { hash: 'prepared' } });
  child.emit('exit', 0, null);
  await pending;
  expect(payload.title).toEqual(title);
  expect(payload.config.effectCatalog).toBeUndefined();
  expect(payload.config.effectCatalogPath).toBeUndefined();
});
