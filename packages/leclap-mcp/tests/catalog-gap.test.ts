import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig, type McpConfig } from '../src/config.js';
import { gapLogPath, safeGapLog } from '../src/compose/catalog-gap-log.js';
import { catalogResponse, catalogResult } from '../src/tools/getMotionCatalog.js';
import { handleValidate } from '../src/tools/validateTemplate.js';

let outputDir: string;
let config: McpConfig;

beforeEach(async () => {
  outputDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-gap-')));
  config = { outputDir, mediaDir: outputDir, renderTimeoutMs: 1000, allowRemotion: false };
});

afterEach(async () => {
  await fs.rm(outputDir, { recursive: true, force: true });
});

async function logLines(file = path.join(outputDir, 'catalog-gaps.jsonl')): Promise<Record<string, unknown>[]> {
  const text = await fs.readFile(file, 'utf8');

  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

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

  it('marks an empty result as a gap without pointing at another tool', () => {
    const result = catalogResponse({ query: 'xyzzy hologram' }) as { matches: unknown[]; gap: { query: string } };

    expect(result.matches).toEqual([]);
    expect(result.gap.query).toBe('xyzzy hologram');
    expect(JSON.stringify(result)).not.toContain('report_catalog_gap');
  });
});

describe('catalog gap log', () => {
  it('appends one JSON line per query that matched nothing, under the output dir', async () => {
    await catalogResult({ query: 'liquid morph' }, config);
    await catalogResult({ query: 'one punch word on the beat' }, config);
    await catalogResult({ query: 'neon xyzzy', kind: 'kinetic' }, config);

    expect(await logLines()).toMatchObject([{ query: 'liquid morph' }, { query: 'neon xyzzy', kind: 'kinetic' }]);
  });

  it('does not log the whole-catalog call', async () => {
    await catalogResult({}, config);

    await expect(fs.access(path.join(outputDir, 'catalog-gaps.jsonl'))).rejects.toThrow();
  });

  it('accepts a configured log inside the output dir and refuses one outside it', async () => {
    expect(await safeGapLog({ outputDir, catalogGapLog: 'logs/gaps.jsonl' })).toBe(
      path.join(outputDir, 'logs', 'gaps.jsonl')
    );
    await expect(safeGapLog({ outputDir, catalogGapLog: '../escape.jsonl' })).rejects.toThrow(/under the output dir/);
    await expect(safeGapLog({ outputDir, catalogGapLog: '/etc/gaps.jsonl' })).rejects.toThrow(/under the output dir/);
    expect(gapLogPath({ outputDir })).toBe(path.join(outputDir, 'catalog-gaps.jsonl'));
  });

  it('still answers the search when the log cannot be written (symlinked folder leading outside)', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-gap-outside-'));

    try {
      await fs.symlink(outside, path.join(outputDir, 'link'));
      const result = await catalogResult({ query: 'xyzzy' }, { ...config, catalogGapLog: 'link/gaps.jsonl' });

      expect(result).toMatchObject({ matches: [], gap: { query: 'xyzzy' } });
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

type Validated = { isError?: boolean; structuredContent?: Record<string, unknown> };

describe('validate_template include: ["timeline"]', () => {
  it('returns sections on absolute seconds, events, beats and cues', async () => {
    const result = (await handleValidate(
      {
        template: {
          global: { beats: { bpm: 60 }, transition: { type: 'cut' } },
          sections: [
            { name: 'a', type: 'color_background', options: { duration: 2 }, cues: { hit: 1 } },
            { name: 'b', type: 'color_background', options: { duration: 1 } },
          ],
        },
        include: ['timeline'],
      },
      config
    )) as Validated;

    expect(result.structuredContent?.valid).toBe(true);
    expect(result.structuredContent?.timeline).toMatchObject({
      duration: 3,
      approx: false,
      sections: [
        { name: 'a', start: 0, end: 2 },
        { name: 'b', start: 2, end: 3 },
      ],
      cues: [{ section: 'a', name: 'hit', time: 1 }],
      beats: [{ beat: 1, time: 0 }, { beat: 2 }, { beat: 3 }, { beat: 4, time: 3 }],
    });
    expect(Array.isArray((result.structuredContent?.timeline as { events?: unknown } | undefined)?.events)).toBe(true);
  });

  it('times the requested format', async () => {
    const template = {
      global: { orientation: 'landscape' },
      sections: [{ name: 'a', type: 'color_background', options: { duration: 2 } }],
    };
    const result = (await handleValidate({ template, include: ['timeline'], format: 'portrait' }, config)) as Validated;

    expect(result.structuredContent?.timeline).toMatchObject({ width: 720, height: 1280 });
  });

  it('omits the timeline unless asked', async () => {
    const template = { sections: [{ name: 'a', type: 'color_background', options: { duration: 2 } }] };
    const result = (await handleValidate({ template }, config)) as Validated;

    expect(result.structuredContent).not.toHaveProperty('timeline');
    expect(result.structuredContent).not.toHaveProperty('resolved');
  });

  it('reports an invalid template as a tool error', async () => {
    const result = (await handleValidate(
      { template: { sections: [{ type: 'nope' }] }, include: ['timeline'] },
      config
    )) as Validated;

    expect(result.isError).toBe(true);
  });
});
