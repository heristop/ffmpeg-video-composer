import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AUTHORED_FILTERS, authoredFilterIssues } from '@/editor/utils/filter-allow-list';
import { assertSafeFilterOptions } from '@/editor/utils/filter-option-guard';
import { TemplateValidator } from '@/services/TemplateValidator';

// Raw `filters` in a template are untrusted by default: only an allow-listed type, with allow-listed
// option names and positional options, passes. Positional options reach file options without a key
// (metadata's 6th, psnr's 1st, curves' 7th…), so every round of deny-listing found another one.

function descriptor(filters: unknown[], maps?: unknown[]): Record<string, unknown> {
  return {
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#204060', duration: 2 },
        filters,
        ...(maps ? { maps } : {}),
      },
    ],
  };
}

const PAYLOADS: Array<Record<string, unknown>> = [
  { type: 'metadata', value: 'print:k:v:same_str:1:/tmp/pwned' },
  { type: 'ametadata', value: 'print:k:v:same_str:1:/tmp/pwned' },
  { type: 'null', value: '1,metadata=print:k:v:same_str:1:/tmp/pwned' },
  { type: 'scale', value: '1280:720,metadata=print:k:v:same_str:1:/tmp/pwned' },
  { type: 'psnr', value: '/tmp/stats.log' },
  { type: 'ssim', value: '/tmp/stats.log' },
  { type: 'signature', value: '0:1:/tmp/sig' },
  { type: 'null', value: ',lut3d=/etc/passwd' },
  { type: 'scale', value: '1:1,lut3d=/etc/passwd' },
  { type: 'curves', value: 'none:a:b:c:d:e:/etc/passwd' },
  { type: 'deshake', value: '0:0:0:0:16:16:0:1:0:0:/tmp/deshake.log' },
  { type: 'lut3d', value: 'url:https://example.com/look.cube@1' },
  { type: 'lut3d', value: '/etc/passwd' },
  { type: 'lut3d', values: { file: '/etc/passwd' } },
  { type: 'drawtext', values: { text: { en: 'hi' }, textfile: '/etc/passwd' } },
  { type: 'drawtext', value: '/etc/passwd' },
  { type: 'drawtext', values: { text: { en: 'hi' }, fontfile: '/etc/passwd' } },
  { type: 'overlay', value: '0:0:eof_action=pass:/etc/x' },
  { type: 'movie', value: '/etc/passwd' },
];

describe('authored filter allow-list', () => {
  it.each(PAYLOADS)('refuses %o', (filter) => {
    const issues = authoredFilterIssues(descriptor([filter]));

    expect(issues.length, JSON.stringify(filter)).toBeGreaterThan(0);
    expect(issues[0].code).toBe('filter_not_allowed');
    expect(issues[0].path).toBe('sections[0].filters[0]');
  });

  it.each([
    {
      type: 'drawtext',
      values: { text: { en: 'Hi' }, x: '(w-text_w)/2', y: 40, fontsize: 48, fontfile: 'Oswald.ttf' },
    },
    { type: 'drawbox', values: { x: 0, y: 0, w: 'iw', h: 40, c: '#000000@0.5', t: 'fill', enable: "'gte(t,1)'" } },
    { type: 'vignette', value: 'PI/5' },
    { type: 'fade', values: { t: 'in', d: 0.5, st: 0, color: '#000000' } },
    { type: 'fadein', values: { color: '#000000' } },
    { type: 'scale', value: 'output' },
    { type: 'scale', value: '1120:558:force_original_aspect_ratio=decrease:force_divisible_by=2' },
    { type: 'pad', value: '1120:558:(ow-iw)/2:(oh-ih)/2:color=0x10141e' },
    { type: 'overlay', value: "x=40:y='if(lt(t,5.3),460,480)'" },
    { type: 'perspective', value: "x0='W*0.025':y0='H*0.1':sense=destination:eval=frame:interpolation=linear" },
    { type: 'lut3d', value: 'teal-orange' },
    { type: 'lut3d', value: 'teal-orange@0.6' },
    { type: 'boxblur', value: 5 },
    { type: 'setpts', value: '0.25*PTS' },
    { type: 'curves', value: 'vintage' },
  ])('keeps %o', (filter) => {
    expect(authoredFilterIssues(descriptor([filter]))).toEqual([]);
  });

  it('walks input and map filters and limits map pad labels', () => {
    const hostileLabel = descriptor([], [{ inputs: ['0:v];movie=/etc/passwd[x'], outputs: ['out'] }]);
    const mapFilter = descriptor([], [{ inputs: ['0:v'], outputs: ['out'], filters: [{ type: 'psnr', value: '/x' }] }]);
    const legit = descriptor([], [{ inputs: ['0:v', '@logo', 'base'], outputs: ['carded'] }]);

    expect(authoredFilterIssues(hostileLabel)[0]?.path).toBe('sections[0].maps[0].inputs[0]');
    expect(authoredFilterIssues(mapFilter)[0]?.path).toBe('sections[0].maps[0].filters[0]');
    expect(authoredFilterIssues(legit)).toEqual([]);
  });

  it('refuses an engine-only graph block in an authored filter', () => {
    const issues = authoredFilterIssues(descriptor([{ type: 'null', graph: [{ filters: [] }] }]));

    expect(issues[0]?.code).toBe('filter_not_allowed');
  });

  it('suggests the nearest allowed filter', () => {
    const [issue] = authoredFilterIssues(descriptor([{ type: 'drawtxt', values: { text: { en: 'x' } } }]));

    expect(issue.suggestion).toBe('drawtext');
  });

  it('lists only file-free filters', () => {
    expect(Object.keys(AUTHORED_FILTERS)).not.toEqual(
      expect.arrayContaining(['metadata', 'psnr', 'ssim', 'signature', 'deshake', 'movie'])
    );
  });
});

describe('validation reports a refused filter instead of failing the render', () => {
  const validator = new TemplateValidator();

  it('is a filter_not_allowed error by default', () => {
    const result = validator.validateTemplate(
      descriptor([{ type: 'metadata', value: 'print:k:v:same_str:1:/tmp/pwned' }])
    );

    expect(result.success).toBe(false);
    expect(result.errors?.map((error) => error.code)).toContain('filter_not_allowed');
  });

  it('is accepted with allowRawFilters (trusted local authors)', () => {
    const result = validator.validateTemplate(descriptor([{ type: 'hflip' }, { type: 'unsharp', value: '5:5:1.0' }]), {
      allowRawFilters: true,
    });

    expect(result.errors?.map((error) => error.code) ?? []).not.toContain('filter_not_allowed');
  });

  it('applies to validateForRender through the project config', () => {
    const hostile = descriptor([{ type: 'psnr', value: '/tmp/stats.log' }]);

    expect(validator.validateForRender(hostile, {}).success).toBe(false);
    expect(
      validator.validateForRender(hostile, { allowRawFilters: true }).errors?.map((error) => error.code) ?? []
    ).not.toContain('filter_not_allowed');
  });
});

describe('deny-list under the opt-in: positional paths', () => {
  it.each([
    ['metadata', 'print:k:v:same_str:1:/tmp/pwned'],
    ['psnr', '/tmp/stats.log'],
    ['signature', '0:1:/tmp/sig'],
    ['curves', 'none:a:b:c:d:e:/etc/passwd'],
    ['null', '1,lut3d=/etc/passwd'],
    ['deshake', '0:0:0:0:16:16:0:1:0:0:../deshake.log'],
  ])('refuses %s=%s', (type, value) => {
    expect(() => assertSafeFilterOptions(type, value)).toThrow(/Unsafe filter value/);
  });

  it.each([
    ['pad', '1120:558:(ow-iw)/2:(oh-ih)/2:color=0x10141e'],
    ['vignette', 'PI/5'],
  ])('keeps %s=%s', (type, value) => {
    expect(assertSafeFilterOptions(type, value)).toBe(value);
  });
});

describe('render path: compile() refuses an authored filter even when validation is skipped', () => {
  it('fails the build with filter_not_allowed before any FFmpeg command', async () => {
    const { compile } = await import('@/index');
    const { testBuildDir } = await import('./fixtures/build-dir');
    const errors: Error[] = [];
    const config = {
      buildDir: testBuildDir('filter-allow-list'),
      currentLocale: 'en',
      videoConfig: { orientation: 'landscape', scale: '1280:720' },
      skipValidation: true,
    };
    const hostile = descriptor([{ type: 'metadata', value: 'print:k:v:same_str:1:/tmp/pwned' }]);

    const out = await compile(config as never, hostile as never, { onError: (error) => errors.push(error) });

    expect(out).toBeNull();
    expect(errors[0]?.message).toContain('filter_not_allowed');
  }, 120000);
});
