import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig, type McpConfig } from '../src/config.js';
import { catalogResponse } from '../src/tools/getMotionCatalog.js';
import { timelineResult } from '../src/tools/getTimeline.js';
import { gapLogPath, reportGap, safeGapLog } from '../src/tools/reportCatalogGap.js';

let outputDir: string;
let config: McpConfig;

beforeEach(async () => {
  outputDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-gap-')));
  config = { outputDir, mediaDir: outputDir, renderTimeoutMs: 1000, allowRemotion: false };
});

afterEach(async () => {
  await fs.rm(outputDir, { recursive: true, force: true });
});

describe('get_motion_catalog search', () => {
  it('returns the whole catalog without a query', () => {
    expect(catalogResponse({})).toHaveProperty('kinetic.presets');
  });

  it('returns ranked matches for a query, limited by kind', () => {
    const result = catalogResponse({ query: 'one punch word on the beat', kind: 'kinetic' }) as {
      matches: Array<{ kind: string; name: string }>;
    };

    expect(result.matches[0]).toMatchObject({ kind: 'kinetic', name: 'impact' });
    expect(result.matches.every((match) => match.kind === 'kinetic')).toBe(true);
  });

  it('points an empty result at report_catalog_gap', () => {
    expect(catalogResponse({ query: 'xyzzy hologram' })).toEqual({
      query: 'xyzzy hologram',
      matches: [],
      gap: { query: 'xyzzy hologram', hint: 'call report_catalog_gap' },
    });
  });
});

describe('get_timeline', () => {
  it('returns sections on absolute seconds, events, beats and cues', () => {
    const result = timelineResult({
      global: { beats: { bpm: 60 }, transition: { type: 'cut' } },
      sections: [
        { name: 'a', type: 'color_background', options: { duration: 2 }, cues: { hit: 1 } },
        { name: 'b', type: 'color_background', options: { duration: 1 } },
      ],
    }) as { structuredContent: Record<string, unknown> };

    expect(result.structuredContent).toMatchObject({
      duration: 3,
      approx: false,
      sections: [
        { name: 'a', start: 0, end: 2 },
        { name: 'b', start: 2, end: 3 },
      ],
      cues: [{ section: 'a', name: 'hit', time: 1 }],
      beats: [{ beat: 1, time: 0 }, { beat: 2 }, { beat: 3 }, { beat: 4, time: 3 }],
    });
    expect(Array.isArray(result.structuredContent.events)).toBe(true);
  });

  it('times the requested format', () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [{ name: 'a', type: 'color_background', options: { duration: 2 } }],
    };
    const result = timelineResult(template, 'portrait') as unknown as {
      structuredContent: { width: number; height: number };
    };

    expect(result.structuredContent).toMatchObject({ width: 720, height: 1280 });
  });

  it('reports an invalid template as a tool error', () => {
    expect(timelineResult({ sections: [{ type: 'nope' }] })).toMatchObject({ isError: true });
  });
});

describe('report_catalog_gap', () => {
  it('appends one JSON line per report under the output dir', async () => {
    await reportGap({ query: 'liquid morph', wanted: 'a blob transition' }, config);
    await reportGap({ query: 'neon', wanted: 'a glow title' }, config);
    const lines = (await fs.readFile(path.join(outputDir, 'catalog-gaps.jsonl'), 'utf8')).trim().split('\n');

    expect(lines.map((line) => JSON.parse(line) as { query: string })).toMatchObject([
      { query: 'liquid morph', wanted: 'a blob transition' },
      { query: 'neon', wanted: 'a glow title' },
    ]);
  });

  it('accepts a configured log inside the output dir and refuses one outside it', async () => {
    expect(await safeGapLog({ outputDir, catalogGapLog: 'logs/gaps.jsonl' })).toBe(
      path.join(outputDir, 'logs', 'gaps.jsonl')
    );
    await expect(safeGapLog({ outputDir, catalogGapLog: '../escape.jsonl' })).rejects.toThrow(/under the output dir/);
    await expect(safeGapLog({ outputDir, catalogGapLog: '/etc/gaps.jsonl' })).rejects.toThrow(/under the output dir/);
    expect(gapLogPath({ outputDir })).toBe(path.join(outputDir, 'catalog-gaps.jsonl'));
  });

  it('refuses a symlinked folder that leads outside the output dir', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-gap-outside-'));

    try {
      await fs.symlink(outside, path.join(outputDir, 'link'));
      const result = await reportGap({ query: 'q', wanted: 'w' }, { ...config, catalogGapLog: 'link/gaps.jsonl' });

      expect(result).toMatchObject({ isError: true });
      await expect(fs.readdir(outside)).resolves.toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('reads the log location from --catalog-gap-log', () => {
    expect(loadConfig(['node', 'x', '--output-dir', outputDir, '--catalog-gap-log', 'g.jsonl']).catalogGapLog).toBe(
      'g.jsonl'
    );
  });
});
