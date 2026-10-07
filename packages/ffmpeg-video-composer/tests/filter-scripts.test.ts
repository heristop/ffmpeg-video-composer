import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { optionFileSyntaxOf, withFilterScripts } from '@/platform/ffmpeg/filter-scripts-node';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import FFmpegNodeAdapter from '@/platform/ffmpeg/FFmpegNodeAdapter';
import FFmpegStaticAdapter from '@/platform/ffmpeg/FFmpegStaticAdapter';

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

  it('passes short filtergraphs inline without looking up the FFmpeg version', async () => {
    const syntax = async (): Promise<'slash'> => {
      throw new Error('version looked up');
    };

    expect(await withFilterScripts(['-vf', 'null'], async (seen) => seen, syntax)).toEqual(['-vf', 'null']);
  });

  it('moves an oversized -vf / -filter_complex into -/option files on FFmpeg 7+ and removes them afterwards', async () => {
    const graph = hugeGraph();
    let seen: string[] = [];
    let contents: string[] = [];

    await withFilterScripts(
      ['-vf', graph, '-filter:a', graph, '-filter_complex', graph, 'out.mp4'],
      async (args) => {
        seen = args;
        contents = [args[1], args[3], args[5]].map((file) => fs.readFileSync(file, 'utf8'));
      },
      async () => 'slash'
    );

    expect([seen[0], seen[2], seen[4]]).toEqual(['-/vf', '-/filter:a', '-/filter_complex']);
    expect(contents).toEqual([graph, graph, graph]);
    expect(fs.existsSync(seen[1])).toBe(false);
  });

  it('uses the script options FFmpeg 6 knows (removed in FFmpeg 9)', async () => {
    const graph = hugeGraph();
    let seen: string[] = [];

    await withFilterScripts(
      ['-af', graph, '-filter_complex', graph, 'out.mp4'],
      async (args) => {
        seen = args;
      },
      async () => 'script'
    );

    expect([seen[0], seen[2]]).toEqual(['-filter_script:a', '-filter_complex_script']);
  });
});

describe('optionFileSyntaxOf', () => {
  it('falls back to the current syntax when the binary cannot be run', async () => {
    expect(await optionFileSyntaxOf('/nonexistent/ffmpeg')).toBe('slash');
  });
});

// The system ffmpeg (FFmpeg 7+: `-/vf`) and ffmpeg-static's 6.0 build (`-filter_script:v`) each get the
// file syntax they accept.
describe.each([
  { binary: 'the system ffmpeg', adapter: (): AbstractFFmpeg => new FFmpegNodeAdapter() },
  { binary: 'ffmpeg-static', adapter: (): AbstractFFmpeg => new FFmpegStaticAdapter() },
])('$binary with a filtergraph past the exec argument limit', ({ adapter }) => {
  it('renders instead of failing to spawn (E2BIG)', async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'filter-scripts-')), 'out.mp4');
    const graph = hugeGraph();

    expect(graph.length).toBeGreaterThan(128 * 1024);
    await adapter().execute(
      `-y -f lavfi -i color=c=black:s=320x180:d=0.5 -vf "${graph}" -c:v libx264 -pix_fmt yuv420p ${out}`
    );
    expect(fs.statSync(out).size).toBeGreaterThan(0);
  }, 60000);
});
