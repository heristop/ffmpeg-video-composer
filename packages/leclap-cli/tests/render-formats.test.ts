import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  formatOutputPath,
  multiFormatRun,
  parseFormatFlag,
  parseFormatsFlag,
  renderEachFormat,
} from '../src/render-formats';
import { buildProjectConfig } from '../src/render-args';
import type { ProjectConfig } from 'ffmpeg-video-composer';

const template = {
  global: { orientation: 'landscape' },
  sections: [{ name: 'hook', type: 'color_background', options: { duration: 2 } }],
  formats: { portrait: { global: { platform: 'shorts' } } },
};

describe('--formats', () => {
  it('expands all to every declared format, in canonical order', () => {
    expect(parseFormatsFlag('all', template)).toEqual(['landscape', 'portrait']);
    expect(parseFormatsFlag('all', { global: { platform: 'tiktok' } })).toEqual(['portrait']);
  });

  it('accepts a comma-separated list, deduplicated and ordered', () => {
    expect(parseFormatsFlag('square, portrait,square', template)).toEqual(['portrait', 'square']);
  });

  it('rejects an unknown or empty list', () => {
    expect(() => parseFormatsFlag('portrait,vertical', template)).toThrow(/--formats expects/);
    expect(() => parseFormatsFlag(',', template)).toThrow(/--formats expects/);
  });
});

describe('--format', () => {
  it('validates the value and lands in ProjectConfig.format', () => {
    expect(parseFormatFlag('square')).toBe('square');
    expect(() => parseFormatFlag('vertical')).toThrow(/--format expects/);
    expect(buildProjectConfig('/work', { format: 'portrait' }).format).toBe('portrait');
    expect(buildProjectConfig('/work', {})).not.toHaveProperty('format');
  });
});

describe('multi-format output naming', () => {
  it('suffixes the output with the format, keeping its extension', () => {
    expect(formatOutputPath('/out/film.mp4', 't.json', 'portrait', '/work')).toBe('/out/film-portrait.mp4');
    expect(formatOutputPath('/out/film.mov', 't.json', 'square', '/work')).toBe('/out/film-square.mov');
    expect(formatOutputPath('/out/film', 't.json', 'square', '/work')).toBe('/out/film-square.mp4');
  });

  it('names outputs after the template without --output', () => {
    expect(formatOutputPath(undefined, 'examples/story.json', 'landscape', '/work')).toBe(
      path.resolve('/work', 'story-landscape.mp4')
    );
  });

  it('renders each format in turn to its own output, with projectConfig.format set', async () => {
    const calls: { format?: string; output?: string }[] = [];
    const opts = {
      templatePath: 'story.json',
      outputAbs: '/out/film.mp4',
      json: true,
      quiet: true,
      projectConfig: { buildDir: '/build' } as ProjectConfig,
    };
    const run = multiFormatRun(opts, async (single) => {
      calls.push({ format: single.projectConfig.format, output: single.outputAbs });

      return single.outputAbs as string;
    });
    const rendered = await renderEachFormat(
      ['landscape', 'portrait', 'square'],
      (format) => formatOutputPath(run.outputAbs, run.templatePath, format, '/work'),
      run.compile
    );

    expect(calls).toEqual([
      { format: 'landscape', output: '/out/film-landscape.mp4' },
      { format: 'portrait', output: '/out/film-portrait.mp4' },
      { format: 'square', output: '/out/film-square.mp4' },
    ]);
    expect(rendered.map((entry) => entry.output)).toEqual(calls.map((call) => call.output));
    expect(opts.projectConfig).toEqual({ buildDir: '/build' });
  });
});
