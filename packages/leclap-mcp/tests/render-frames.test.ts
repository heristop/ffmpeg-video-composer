import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { McpConfig } from '../src/config.js';
import * as snapshotRunner from '../src/compose/snapshotRunner.js';
import { registerRenderFrames, renderFramesInput } from '../src/tools/renderFrames.js';
import { runSnapshotJob, type SnapshotJob } from '../src/worker/snapshot-job.js';

vi.mock('../src/compose/snapshotRunner.js', async (original) => ({
  ...(await original<typeof snapshotRunner>()),
  runSnapshot: vi.fn(),
}));

const runSnapshotMock = vi.mocked(snapshotRunner.runSnapshot);

type Handler = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

// A 2×1 PNG: signature, IHDR (width 2, height 1), enough for the image block.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000002000000010806000000f478d4fa0000000d49444154789c6360000002000001e221bc330000000049454e44ae426082',
  'hex'
);

let outputDir: string;
let mediaDir: string;
let config: McpConfig;

function capture(): { handler: Handler; meta: { inputSchema: unknown; outputSchema: unknown } } {
  let handler: Handler | undefined;
  let meta: { inputSchema: unknown; outputSchema: unknown } | undefined;

  registerRenderFrames(
    {
      registerTool: (name: string, m: typeof meta, cb: Handler) => {
        expect(name).toBe('render_frames');
        meta = m;
        handler = cb;
      },
    } as never,
    config
  );

  if (!handler || !meta) throw new Error('render_frames was not registered');

  return { handler, meta };
}

const template = {
  meta: { name: 'Card' },
  global: { orientation: 'landscape', musicEnabled: false },
  sections: [{ name: 'card', type: 'color_background', options: { backgroundColor: '#111111', duration: 2 } }],
};

beforeEach(async () => {
  vi.clearAllMocks();
  outputDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-frames-out-')));
  mediaDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-frames-media-')));
  config = { outputDir, mediaDir, renderTimeoutMs: 1000, allowRemotion: false };
});

afterEach(async () => {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.rm(mediaDir, { recursive: true, force: true });
});

describe('render_frames schema', () => {
  it('accepts moments as seconds or time references, and bounded sheets and variants', () => {
    expect(
      renderFramesInput.safeParse({
        template,
        at: [1.5, 'intro.end', 'beat:8'],
        sheet: { cols: 3, rows: 2 },
        safe: 'tiktok',
        zoom: { x: 0, y: 0, w: 0.5, h: 0.5 },
      }).success
    ).toBe(true);
    expect(renderFramesInput.safeParse({ template, sheet: { cols: 9, rows: 1 } }).success).toBe(false);
    expect(renderFramesInput.safeParse({ template, at: [-1] }).success).toBe(false);
    expect(renderFramesInput.safeParse({ template, variants: Array.from({ length: 6 }, () => template) }).success).toBe(
      false
    );
  });

  it('registers an input and output schema', () => {
    const { meta } = capture();

    expect(meta.inputSchema).toBe(renderFramesInput);
    expect(meta.outputSchema).toBeInstanceOf(z.ZodObject);
  });
});

describe('render_frames handler', () => {
  it('runs a frames job under the output dir and returns PNG image content plus paths', async () => {
    runSnapshotMock.mockImplementation(async (job) => {
      const frame = path.join(job.options.outDir, 'frame-01-0.50s.png');

      await fs.mkdir(job.options.outDir, { recursive: true });
      await fs.writeFile(frame, PNG);

      return {
        ok: true,
        snapshot: {
          frames: [{ path: frame, width: 2, height: 1, time: 0.5, label: '0.5s', section: 'card' }],
          sheets: [],
        },
      };
    });
    const { handler } = capture();
    const result = await handler({ template, at: [0.5], safe: 'tiktok' });
    const job = runSnapshotMock.mock.calls[0][0] as Extract<SnapshotJob, { mode: 'frames' }>;

    expect(job).toMatchObject({ kind: 'snapshot', mode: 'frames', options: { at: [0.5], safe: 'tiktok' } });
    expect(job.options.outDir.startsWith(`${outputDir}${path.sep}frames-`)).toBe(true);
    expect(job.options.cacheDir).toBe(path.join(outputDir, '.section-cache'));
    expect(job.options.assetsDir).toBe(mediaDir);
    expect(result.content).toEqual([
      expect.objectContaining({ type: 'text' }),
      { type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' },
    ]);
    expect(result.structuredContent).toMatchObject({ frames: [{ time: 0.5, section: 'card' }], sheets: [] });
  });

  it('sends variants as one compare job at the first moment', async () => {
    runSnapshotMock.mockResolvedValue({ ok: false, error: 'render failed: boom' });
    const { handler } = capture();
    const result = await handler({ template, variants: [{ ...template, meta: { name: 'Other' } }], at: ['50%'] });
    const job = runSnapshotMock.mock.calls[0][0] as Extract<SnapshotJob, { mode: 'compare' }>;

    expect(job.mode).toBe('compare');
    expect(job.variants.map((variant) => variant.label)).toEqual(['Card', 'Other']);
    expect(job.options.at).toBe('50%');
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result.content)).toContain('boom');
    expect((await fs.readdir(outputDir)).filter((entry) => entry.startsWith('frames-'))).toEqual([]);
  });

  it('resolves the requested format before rendering', async () => {
    runSnapshotMock.mockResolvedValue({ ok: false, error: 'stop' });
    const { handler } = capture();

    await handler({ template, format: 'portrait' });
    const job = runSnapshotMock.mock.calls[0][0] as Extract<SnapshotJob, { mode: 'frames' }>;

    expect(job.template.global?.orientation).toBe('portrait');
  });

  it('refuses an invalid template or an escaping clip before rendering', async () => {
    const { handler } = capture();
    const invalid = await handler({ template: { sections: [{ type: 'nope' }] } });
    const escaping = await handler({
      template: { sections: [{ name: 'clip', type: 'project_video', options: { duration: 1 } }] },
      userVideoPaths: { clip: '/etc/passwd' },
    });

    expect(invalid).toMatchObject({ isError: true });
    expect(escaping).toMatchObject({ isError: true });
    expect(runSnapshotMock).not.toHaveBeenCalled();
  });
});

describe('snapshot worker job', () => {
  it('dispatches each mode and reports a thrown error as a failed job', async () => {
    const sheet = { path: '/s.png', width: 1, height: 1 };
    const engine = {
      frames: vi.fn(async () => ({ frames: [], sheets: [sheet], duration: 1 })),
      compare: vi.fn(async () => ({ frames: [], sheet })),
      looks: vi.fn(async () => {
        throw new Error('no section');
      }),
    };
    const options = { outDir: '/o', at: 1 };

    await expect(
      runSnapshotJob(
        { kind: 'snapshot', mode: 'frames', template: {} as never, options: { outDir: '/o', at: [1] } },
        engine
      )
    ).resolves.toEqual({
      ok: true,
      snapshot: { frames: [], sheets: [sheet] },
    });
    await expect(runSnapshotJob({ kind: 'snapshot', mode: 'compare', variants: [], options }, engine)).resolves.toEqual(
      { ok: true, snapshot: { frames: [], sheets: [sheet] } }
    );
    await expect(
      runSnapshotJob({ kind: 'snapshot', mode: 'looks', template: {} as never, options }, engine)
    ).resolves.toEqual({
      ok: false,
      error: 'no section',
    });
  });

  it('reads the worker message, treating a frameless success as a failure', () => {
    expect(snapshotRunner.snapshotRunResult({ ok: true }, 'tail')).toMatchObject({
      ok: false,
      error: 'render worker returned no frames',
    });
    expect(snapshotRunner.snapshotRunResult({ ok: false, error: 'x' }, '')).toMatchObject({ ok: false, error: 'x' });
  });
});
