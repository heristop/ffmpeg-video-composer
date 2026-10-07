import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withFilterScripts } from '@/platform/ffmpeg/filter-scripts-node';
import FFmpegNodeAdapter from '@/platform/ffmpeg/FFmpegNodeAdapter';

// One drawbox per frame window, the shape of a long stepped/per-frame lowering, well past the 128 KiB
// single-argument limit of Linux exec.
function hugeGraph(): string {
  const boxes = Array.from(
    { length: 2500 },
    (_, i) => `drawbox=x=${i % 300}:y=${i % 160}:w=8:h=8:color=white:t=fill:enable='between(t,${i / 1000},${i / 1000})'`
  );

  return `${boxes.join(',')},format=yuv420p`;
}

describe('withFilterScripts', () => {
  it('passes short filtergraphs inline', async () => {
    const args = ['-i', 'in.mp4', '-vf', 'scale=320:180', 'out.mp4'];

    expect(await withFilterScripts(args, async (seen) => seen)).toEqual(args);
  });

  it('moves an oversized -vf / -filter_complex into script files and removes them afterwards', async () => {
    const graph = hugeGraph();
    let seen: string[] = [];
    let contents: string[] = [];

    await withFilterScripts(['-vf', graph, '-filter_complex', graph, 'out.mp4'], async (args) => {
      seen = args;
      contents = [args[1], args[3]].map((file) => fs.readFileSync(file, 'utf8'));
    });

    expect(seen[0]).toBe('-filter_script:v');
    expect(seen[2]).toBe('-filter_complex_script');
    expect(contents).toEqual([graph, graph]);
    expect(fs.existsSync(seen[1])).toBe(false);
  });
});

describe('FFmpegNodeAdapter with a filtergraph past the exec argument limit', () => {
  it('renders instead of failing to spawn (E2BIG)', async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'filter-scripts-')), 'out.mp4');
    const graph = hugeGraph();

    expect(graph.length).toBeGreaterThan(128 * 1024);
    await new FFmpegNodeAdapter().execute(
      `-y -f lavfi -i color=c=black:s=320x180:d=0.5 -vf "${graph}" -c:v libx264 -pix_fmt yuv420p ${out}`
    );
    expect(fs.statSync(out).size).toBeGreaterThan(0);
  }, 60000);
});
