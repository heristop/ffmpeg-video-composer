import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compareSnapshots, renderSnapshots } from '@/index';
import type { TemplateDescriptor } from '@/core/types';
import { pngSize } from '@/services/snapshot-node';
import { testBuildDir } from './fixtures/build-dir';

// A real snapshot of an asset-free example: the template renders through the engine, and every planned
// moment comes back as a PNG at the output frame size, plus a contact sheet of the tiles.

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.resolve(here, '../../../examples/motion-design/kinetic-type.json');
const descriptor = JSON.parse(fs.readFileSync(example, 'utf8')) as TemplateDescriptor;
const root = testBuildDir('snapshot-render');

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function size(file: string) {
  return pngSize(new Uint8Array(fs.readFileSync(file)));
}

describe('renderSnapshots (real render)', () => {
  it('grabs PNG frames at numbers, section edges and transitions, and tiles a sheet', async () => {
    const outDir = path.join(root, 'frames');
    const result = await renderSnapshots(descriptor, {
      at: [1.5, 'hook.end'],
      atTransitions: true,
      sheet: { cols: 3, rows: 2 },
      safe: 'tiktok',
      outDir,
      workDir: root,
      cacheDir: path.join(root, 'cache'),
    });

    expect(result.frames.length).toBeGreaterThanOrEqual(4);
    expect(result.frames.map((frame) => frame.time)).toEqual(
      result.frames.map((f) => f.time).toSorted((a, b) => a - b)
    );

    for (const frame of result.frames) {
      expect(fs.existsSync(frame.path)).toBe(true);
      expect(size(frame.path)).toEqual({ width: 1280, height: 720 });
      expect(frame).toMatchObject({ width: 1280, height: 720 });
    }

    expect(result.frames.find((frame) => frame.label === 'hook.end')?.section).toBe('keynote');
    expect(result.sheets.length).toBe(Math.ceil(result.frames.length / 6));
    const sheet = size(result.sheets[0].path);

    // 3 tiles of 480 px with 6 px padding and margin.
    expect(sheet.width).toBe(3 * 480 + 4 * 6);
    expect(sheet.height).toBe(2 * 270 + 3 * 6);
  }, 240000);

  it('crops a zoomed region', async () => {
    const result = await renderSnapshots(descriptor, {
      at: ['stat.start + 2'],
      zoom: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      outDir: path.join(root, 'zoom'),
      workDir: root,
      cacheDir: path.join(root, 'cache'),
    });

    expect(result.frames).toHaveLength(1);
    expect(size(result.frames[0].path)).toEqual({ width: 640, height: 360 });
  }, 240000);

  it('compares two variants in one labelled grid', async () => {
    const variant = structuredClone(descriptor) as { global: Record<string, unknown> };

    variant.global.look = 'noir';
    const result = await compareSnapshots(
      [
        { label: 'a', descriptor },
        { label: 'noir', descriptor: variant as unknown as TemplateDescriptor },
      ],
      { at: 1.5, outDir: path.join(root, 'compare'), workDir: root, cacheDir: path.join(root, 'cache') }
    );

    expect(result.frames).toHaveLength(2);
    expect(size(result.sheet.path)).toEqual({ width: 2 * 480 + 3 * 6, height: 270 + 2 * 6 });
  }, 240000);
});
