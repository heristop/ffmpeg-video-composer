import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import FormatterManager from '@/editor/managers/FormatterManager';

// Raw filter `values` are an authoring feature (any drawtext/drawbox option), so the formatter cannot
// allow-list keys. It refuses what turns a value into a file read or a second option instead: the
// file-reading option keys, a font file that is not a bare staged font name, and a value that ends its
// option (an unquoted `:`) or its filter (an unquoted `,` `;` `[` `]`) once FFmpeg un-quotes it.

function format(values: Record<string, unknown>): string {
  const template = { descriptor: {}, assets: { fonts: {}, musics: {}, inputs: {} } };
  const project = { config: { currentLocale: 'en', videoConfig: {} } };
  const vm = { mapVariables: vi.fn((value: string) => value) };
  const segment = {
    currentSection: { name: 's', type: 'video', options: {} },
    fontsDir: '/build/fonts',
    tempFonts: [],
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const manager = new FormatterManager(
    project as never,
    template as never,
    vm as never,
    segment as never,
    logger as never
  );

  return manager.formatMultipleTypesValues({ type: 'drawtext', values } as never);
}

describe('raw filter values: file-reading keys', () => {
  it.each(['textfile', 'filename', 'file', 'f', 'psfile', 'pfile', 'model_filename', 'stats_file'])(
    'refuses %s',
    (key) => {
      expect(() => format({ [key]: '/etc/passwd' })).toThrow(new RegExp(key));
    }
  );
});

describe('raw filter values: fontfile', () => {
  it('keeps a bare font file name, staged under the fonts dir', () => {
    expect(format({ fontfile: 'Rubik+Doodle+Shadow.ttf' })).toBe(
      "drawtext=fontfile='/build/fonts/Rubik+Doodle+Shadow.ttf'"
    );
  });

  it.each([
    '/etc/passwd',
    '../../etc/x.ttf',
    'fonts/x.ttf',
    String.raw`a\b.ttf`,
    "x.ttf':textfile=/etc/passwd",
    'x:y.ttf',
  ])('refuses %s', (fontfile) => {
    expect(() => format({ fontfile })).toThrow(/fontfile/);
  });
});

describe('raw filter values: option and filter escapes', () => {
  it.each([
    ['fontcolor_expr', 'white:textfile=/etc/passwd'],
    ['x', '10:textfile=/etc/passwd'],
    ['x', "'10':textfile=/etc/passwd"],
    ['x', '10,movie=/etc/passwd'],
    ['y', '10;[x]nullsink'],
    ['alpha', "'0.5"],
  ])('refuses %s=%s', (key, value) => {
    expect(() => format({ [key]: value })).toThrow(new RegExp(`Unsafe filter value ${key}`));
  });

  it.each([
    ['x', '(w-text_w)/2', 'x=(w-text_w)/2'],
    ['enable', "'between(t,1,2)'", "enable='between(t,1,2)'"],
    ['alpha', "'if(lt(t,1),t,1)'", "alpha='if(lt(t,1),t,1)'"],
    ['y', 'h-th-20', 'y=h-th-20'],
    ['fontsize', 48, 'fontsize=48'],
    ['timecode', String.raw`'00\:00\:01\:00'`, String.raw`timecode='00\:00\:01\:00'`],
  ])('keeps %s=%s', (key, value, expected) => {
    expect(format({ [key]: value })).toBe(`drawtext=${expected}`);
  });
});
