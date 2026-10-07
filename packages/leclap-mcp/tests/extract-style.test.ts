import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { McpConfig } from '../src/config.js';
import { handleExtractStyle, registerExtractStyle, type StyleAnalyzer } from '../src/tools/extractStyle.js';

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
}

let mediaDir: string;
let outsideDir: string;
let config: McpConfig;

beforeEach(async () => {
  mediaDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-style-media-')));
  outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-style-outside-')));
  config = { outputDir: mediaDir, mediaDir, renderTimeoutMs: 1000, allowRemotion: false };
});

afterEach(async () => {
  await fs.rm(mediaDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

const neverAnalyzer: StyleAnalyzer = async () => {
  throw new Error('analyzer must not run when the path is rejected');
};

describe('extract_style path guard', () => {
  it('registers under its tool name', () => {
    const names: string[] = [];
    registerExtractStyle({ registerTool: (name: string) => names.push(name) } as never, config);

    expect(names).toEqual(['extract_style']);
  });

  it('rejects a reference outside the media dir', async () => {
    const outside = path.join(outsideDir, 'ref.png');
    await fs.writeFile(outside, 'x');
    const result = await handleExtractStyle({ path: outside }, config, neverAnalyzer);

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain('escapes the media directory');
  });

  it('rejects a relative path', async () => {
    const result = await handleExtractStyle({ path: 'ref.png' }, config, neverAnalyzer);

    expect(JSON.stringify(result)).toContain('must be absolute');
  });
});

describe.skipIf(!hasFfmpeg())('extract_style (ffmpeg)', () => {
  it('derives a theme and a pacing guide from a cut clip', async () => {
    const clip = path.join(mediaDir, 'cuts.mp4');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x182030:s=320x180:r=25:d=2',
      '-f',
      'lavfi',
      '-i',
      'testsrc=s=320x180:r=25:d=2',
      '-filter_complex',
      '[0][1]concat=n=2:v=1:a=0',
      '-pix_fmt',
      'yuv420p',
      clip,
    ]);
    const result = await handleExtractStyle({ path: clip }, config);

    expect(result).not.toHaveProperty('isError');

    const structured = (result as { structuredContent: Record<string, any> }).structuredContent;

    expect(structured.theme.colors.bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(structured.styleGuide.pacing.cuts).toBe(1);
    expect(structured.styleGuide.source.kind).toBe('clip');
    expect(JSON.stringify(result)).toContain('never copied');
  });

  it('reports a decode failure as a tool error', async () => {
    const bogus = path.join(mediaDir, 'bogus.mp4');
    await fs.writeFile(bogus, 'not a video');
    const result = await handleExtractStyle({ path: bogus }, config);

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain('Style extraction failed');
  });
});
