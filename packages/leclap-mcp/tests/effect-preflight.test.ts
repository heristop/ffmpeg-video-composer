import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validateEffects, type EffectConfig } from '../src/effects/title-registry.js';
import { acquireEffectJobPermit } from '../src/effects/effect-job-budget.js';
import { probeMedia, type ProbeInfos } from '../src/tools/probeMedia.js';

vi.mock('../src/tools/probeMedia.js', () => ({ probeMedia: vi.fn() }));
const infos: ProbeInfos = {
  durationSeconds: 10,
  videoCodec: 'h264',
  audioCodec: null,
  sampleRate: null,
  sizeBytes: 4,
  hdr: null,
  colorPrimaries: null,
  colorTransfer: null,
  bitDepth: null,
  vfr: false,
  rotation: 0,
};
let directory: string;
let config: EffectConfig;

function template(backgrounds: string[]) {
  return {
    sections: backgrounds.map((background, index) => ({
      name: `title-${index}`,
      type: 'effect',
      options: { duration: 10 },
      effect: {
        id: 'leclap.title-reveal',
        version: '1.0.0',
        props: {},
        assets: { background, logo: 'logo.png', font: 'font.ttf' },
      },
    })),
  };
}

beforeEach(async () => {
  vi.mocked(probeMedia).mockReset().mockResolvedValue(infos);
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effect-preflight-')));
  for (const name of ['one.mp4', 'two.mp4', 'logo.png', 'font.ttf', 'root.tsx']) {
    await fs.writeFile(path.join(directory, name), 'test');
  }
  config = {
    mediaDir: directory,
    allowRemotion: true,
    remotionEntry: path.join(directory, 'root.tsx'),
    renderTimeoutMs: 1000,
  };
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

it('probes a shared realpath once per request, including a symlink alias', async () => {
  await fs.symlink(path.join(directory, 'one.mp4'), path.join(directory, 'alias.mp4'));
  const prepared = await validateEffects(template(['one.mp4', 'alias.mp4', 'one.mp4']), config);
  expect(prepared.size).toBe(3);
  expect(probeMedia).toHaveBeenCalledTimes(1);
});

it('serializes distinct video probes across sections and concurrent requests', async () => {
  let active = 0;
  let maximum = 0;
  vi.mocked(probeMedia).mockImplementation(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return infos;
  });
  await Promise.all([
    validateEffects(template(['one.mp4', 'two.mp4']), config),
    validateEffects(template(['two.mp4', 'one.mp4']), config),
  ]);
  expect(maximum).toBe(1);
});

it('waits for the existing effect permit before probing and releases its permit afterwards', async () => {
  const release = await acquireEffectJobPermit(1000);
  const pending = validateEffects(template(['one.mp4']), config);
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(probeMedia).not.toHaveBeenCalled();
  } finally {
    release();
    await pending;
  }
  (await acquireEffectJobPermit(100))();
});

it.each(['abort', 'timeout'] as const)(
  'stops active preflight on %s without probing the next asset or leaking a permit',
  async (mode) => {
    const controller = new AbortController();
    let started = false;
    let stopped = false;
    vi.mocked(probeMedia).mockImplementation(async (_file, _size, _runner, signal) => {
      started = true;
      if (!signal) return infos;
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            stopped = true;
            reject(signal.reason instanceof Error ? signal.reason : new Error('Probe aborted'));
          },
          { once: true }
        );
      });
    });
    const pending = validateEffects(
      template(['one.mp4', 'two.mp4']),
      {
        ...config,
        renderTimeoutMs: mode === 'timeout' ? 100 : 1000,
      },
      controller.signal
    ).then(
      () => null,
      (error: Error) => error
    );
    await vi.waitFor(() => expect(started).toBe(true));
    if (mode === 'abort') controller.abort(new Error('caller cancelled'));
    const error = await pending;
    expect(error?.message).toMatch(mode === 'abort' ? /caller cancelled/ : /timed out/);
    expect(stopped).toBe(true);
    expect(probeMedia).toHaveBeenCalledTimes(1);
    (await acquireEffectJobPermit(100))();
  }
);

it('cancels queued preflight without starting a probe or leaking a waiter', async () => {
  const release = await acquireEffectJobPermit(1000);
  const controller = new AbortController();
  const pending = validateEffects(template(['one.mp4']), config, controller.signal);
  controller.abort();
  try {
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(probeMedia).not.toHaveBeenCalled();
  } finally {
    release();
  }
  (await acquireEffectJobPermit(100))();
});
