import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import FormatterManager from '@/editor/managers/FormatterManager';
import { FilterSchema } from '@/schemas/filter.schemas';

// Raw filter `values` are an authoring feature (any drawtext/drawbox option), so the formatter cannot
// allow-list keys. It refuses what turns a value into a file read or a second option instead: the
// file-reading option keys, a font file that is not a bare staged font name, and a value that ends its
// option (an unquoted `:`) or its filter (an unquoted `,` `;` `[` `]`) once FFmpeg un-quotes it.

function manager(): FormatterManager {
  const template = { descriptor: {}, assets: { fonts: {}, musics: {}, inputs: {} } };
  const project = { config: { currentLocale: 'en', videoConfig: {} } };
  const vm = { mapVariables: vi.fn((value: string) => value) };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const segment = {
    currentSection: { name: 's', type: 'video', options: {} },
    fontsDir: '/build/fonts',
    lutsDir: '/build/luts',
    tempFonts: [],
    tempLuts: [],
  };

  return new FormatterManager(project as never, template as never, vm as never, segment as never, logger as never);
}

function format(values: Record<string, unknown>): string {
  return manager().formatMultipleTypesValues({ type: 'drawtext', values } as never);
}

// A filter with a scalar `value` (`type=value`), as the section/map chains serialize it.
function formatValue(type: string, value: string): string {
  return manager().formatMultipleTypesValue({ type, value } as never);
}

describe('raw filter values: file-reading keys', () => {
  it.each([
    'textfile',
    'filename',
    'file',
    'f',
    'psfile',
    'pfile',
    'model_filename',
    'stats_file',
    'model',
    'm',
    'sofa',
    'cover',
    'object',
    'datapath',
    'dumpfile',
    'log_path',
    'destination',
    'commands',
  ])('refuses %s', (key) => {
    expect(() => format({ [key]: '/etc/passwd' })).toThrow(new RegExp(key));
  });
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
    ['x', '10\\'],
    ['x', String.raw`'10\'`],
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

describe('raw filters: type and scalar value', () => {
  it.each(['drawtext=textfile=/etc/passwd:x', 'Drawtext', 'draw text', 'drawtext,movie'])(
    'refuses the type %s',
    (type) => {
      expect(() => formatValue(type, '0')).toThrow(/Unsafe filter type/);
      expect(() => manager().formatMultipleTypesValues({ type, values: { x: '0' } } as never)).toThrow(
        /Unsafe filter type/
      );
    }
  );

  it.each([
    'movie',
    'amovie',
    'subtitles',
    'ass',
    'sendcmd',
    'asendcmd',
    'lut1d',
    'haldclut',
    'zmq',
    'azmq',
    'ladspa',
    'lv2',
    'frei0r',
    'arnndn',
    'sofalizer',
    'whisper',
    'cover_rect',
    'find_rect',
    'removelogo',
    'ocr',
    'dnn_processing',
    'dnn_detect',
  ])('refuses the file- or command-capable filter %s', (type) => {
    expect(() => formatValue(type, '/etc/passwd')).toThrow(/Unsafe filter type/);
  });

  it.each([
    ['drawtext', 'textfile=/etc/passwd:x=0'],
    ['drawtext', "x=0:'textfile'=/etc/passwd"],
    ['drawtext', '/etc/passwd'],
    ['overlay', '0:0,movie=/etc/passwd'],
    ['scale', '1280:720,drawtext=textfile=/etc/passwd'],
    ['scale', '1280:720,Drawtext=x=0'],
    ['pad', '1280:720:0:0:color=black;[x]nullsink'],
    ['vignette', 'PI/5\\'],
  ])('refuses %s=%s', (type, value) => {
    expect(() => formatValue(type, value)).toThrow(/Unsafe filter (value|type)/);
  });

  it.each([
    ['fps', '30'],
    ['pad', '1120:558:(ow-iw)/2:(oh-ih)/2:color=0x10141e'],
    ['overlay', "x=40:y='if(lt(t,5.3),460,480)'"],
    ['perspective', "x0='W*0.025':y0='H*0.1':sense=destination:eval=frame:interpolation=linear"],
    ['vignette', 'PI/5'],
    ['boxblur', '5'],
    ['scale', '1280:720:force_original_aspect_ratio=increase,crop=1280:720'],
    ['fps', '30,null'],
  ])('keeps %s=%s', (type, value) => {
    expect(formatValue(type, value)).toBe(`${type}=${value}`);
  });

  it('keeps the LUT look (the value names a staged LUT, never a path)', () => {
    expect(formatValue('lut3d', 'teal-orange')).toBe("lut3d=file='/build/luts/teal-orange.cube'");
    expect(formatValue('lut3d', 'url:https://example.com/a.cube@0.5')).toMatch(
      /^lut3d=file='\/build\/luts\/user-[0-9a-f]{16}-s0500\.cube'$/
    );
  });

  it.each(['../../etc/passwd', "x':textfile=/etc/passwd", 'a/b'])('refuses a LUT preset name %s', (value) => {
    expect(() => formatValue('lut3d', value)).toThrow(/Unsafe LUT/);
  });
});

describe('raw filters: schema', () => {
  it.each(['drawtext=textfile=/etc/passwd:x', 'Drawtext', 'draw text', 'drawtext,movie'])(
    'rejects the type %s',
    (type) => {
      expect(FilterSchema.safeParse({ type, value: '0' }).success).toBe(false);
    }
  );

  it.each(['drawtext', 'lut3d', 'fadein', 'setsar'])('accepts the type %s', (type) => {
    expect(FilterSchema.safeParse({ type, value: '1' }).success).toBe(true);
  });
});
