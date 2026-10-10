import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { templateFontErrors } from '@/services/html-node/template-fonts-node';
import { TEMPLATE_FONT_MAX_BYTES } from '@/core/html/template-fonts';
import FilesystemNodeAdapter from '@/platform/filesystem/FilesystemNodeAdapter';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

const here = path.dirname(fileURLToPath(import.meta.url));
const pacifico = path.resolve(here, '../../leclap-creative-kit/src/library/fonts/Pacifico.ttf');

function template(fonts: unknown[], css = 'p { font: 40px Brand }'): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false, fonts },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2 },
        inputs: [{ name: 'tag', type: 'html', html: '<p>Hi</p>', css, width: 400, height: 100 }],
      },
    ],
  } as unknown as TemplateDescriptor;
}

function errors(descriptor: TemplateDescriptor) {
  return new TemplateValidator().validateTemplate(descriptor).errors ?? [];
}

function warnings(descriptor: TemplateDescriptor) {
  return new TemplateValidator()
    .getMotionWarnings(descriptor)
    .filter((warning) => warning.code.startsWith('font_') || warning.code === 'html_font_unknown');
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'leclap-template-fonts-'));
const fontsDir = path.join(scratch, 'fonts');
const assetsDir = path.join(scratch, 'assets');
const outside = path.join(scratch, 'outside');

fs.mkdirSync(fontsDir);
fs.mkdirSync(assetsDir);
fs.mkdirSync(outside);
fs.copyFileSync(pacifico, path.join(fontsDir, 'Brand.ttf'));
fs.copyFileSync(pacifico, path.join(assetsDir, 'InAssets.ttf'));
fs.copyFileSync(pacifico, path.join(outside, 'Secret.ttf'));
fs.writeFileSync(path.join(fontsDir, 'page.ttf'), '<!doctype html><title>404</title>');
fs.symlinkSync(path.join(outside, 'Secret.ttf'), path.join(fontsDir, 'Escape.ttf'));
fs.writeFileSync(path.join(fontsDir, 'Huge.ttf'), '');
fs.truncateSync(path.join(fontsDir, 'Huge.ttf'), TEMPLATE_FONT_MAX_BYTES + 1);

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe('global.fonts schema', () => {
  it('accepts a family with a file, a weight and a style', () => {
    expect(errors(template([{ family: 'Brand', src: 'Brand.ttf', weight: 700, style: 'italic' }]))).toEqual([]);
  });

  it('refuses a URL src: fonts are never fetched', () => {
    const found = errors(template([{ family: 'Brand', src: 'https://fonts.example.com/Brand.ttf' }]));

    expect(found.map((error) => [error.path, error.message])).toEqual([
      ['global.fonts.0.src', 'fonts are never fetched: src is a local path or a data: URI, not a URL'],
    ]);
  });

  it('refuses a weight off the 100 steps and an unknown key', () => {
    expect(errors(template([{ family: 'Brand', src: 'Brand.ttf', weight: 450 }])).map((error) => error.path)).toEqual([
      'global.fonts.0.weight',
    ]);
    expect(errors(template([{ family: 'Brand', src: 'Brand.ttf', url: 'x' }]))).not.toEqual([]);
  });
});

describe('global.fonts descriptor rules', () => {
  it('refuses a WOFF2 src with the command that converts it', () => {
    const [error] = errors(template([{ family: 'Brand', src: 'fonts/Brand.woff2' }]));

    expect(error).toMatchObject({
      path: 'global.fonts[0].src',
      code: 'font_woff2_unsupported',
      suggestion: 'fonts/Brand.ttf',
    });
    expect(error.hint).toMatch(/fonttools ttLib\.woff2 decompress/);
  });

  it('refuses a src that is no font', () => {
    expect(errors(template([{ family: 'Brand', src: 'logo.png' }])).map((error) => error.code)).toEqual([
      'font_format',
    ]);
    expect(
      errors(template([{ family: 'Brand', src: 'data:image/png;base64,AAAA' }])).map((error) => error.code)
    ).toEqual(['font_format']);
  });
});

describe('global.fonts advisories', () => {
  it('knows a declared family: no html_font_unknown, no font_unused', () => {
    expect(warnings(template([{ family: 'Brand', src: 'Brand.ttf' }]))).toEqual([]);
  });

  it('warns about a declared family no HTML layer selects, once per family', () => {
    const found = warnings(
      template(
        [
          { family: 'Ubuntu', src: 'Ubuntu-Regular.ttf', weight: 400 },
          { family: 'Ubuntu', src: 'Ubuntu-Bold.ttf', weight: 700 },
        ],
        'p { font: 40px Rubik }'
      )
    );

    expect(found.map((warning) => [warning.code, warning.path])).toEqual([['font_unused', 'global.fonts[0]']]);
    expect(found[0].message).toBe('global.fonts: "Ubuntu" is declared but no HTML layer selects it');
  });

  it('still names an undeclared family, pointing at global.fonts', () => {
    const [warning] = warnings(template([], 'p { font: 40px Ubuntu }'));

    expect(warning).toMatchObject({ code: 'html_font_unknown' });
    expect(warning.hint).toContain('global.fonts');
  });
});

describe('templateFontErrors (Node)', () => {
  const check = (fonts: unknown[]) => templateFontErrors(template(fonts), { assetsDir, fontDirs: [fontsDir] });

  it('finds a font in the font dirs, then the assets dir, relative or absolute', async () => {
    expect(
      await check([
        { family: 'Brand', src: 'Brand.ttf' },
        { family: 'Brand', src: path.join(fontsDir, 'Brand.ttf'), weight: 700 },
        { family: 'Brand', src: 'InAssets.ttf', weight: 300 },
      ])
    ).toEqual([]);
  });

  it('reports a missing file, and a file outside the allowed dirs as missing', async () => {
    const found = await check([
      { family: 'Brand', src: 'Nope.ttf' },
      { family: 'Brand', src: path.join(outside, 'Secret.ttf') },
      { family: 'Brand', src: '../outside/Secret.ttf' },
      { family: 'Brand', src: 'Escape.ttf' },
    ]);

    expect(found.map((error) => [error.path, error.code])).toEqual([
      ['global.fonts[0].src', 'font_not_found'],
      ['global.fonts[1].src', 'font_not_found'],
      ['global.fonts[2].src', 'font_not_found'],
      ['global.fonts[3].src', 'font_not_found'],
    ]);
    expect(found[0].message).toMatch(/^global\.fonts\[0\] \(Brand\): "Nope\.ttf" was not found/);
  });

  it('reports a file that is no font, and one over the size limit, without reading it', async () => {
    const found = await check([
      { family: 'Brand', src: 'page.ttf' },
      { family: 'Brand', src: 'Huge.ttf' },
    ]);

    expect(found.map((error) => error.code)).toEqual(['font_format', 'font_too_large']);
  });

  it('leaves a src the descriptor rules already refuse to them', async () => {
    expect(await check([{ family: 'Brand', src: 'Brand.woff2' }])).toEqual([]);
  });
});

describe('FilesystemNodeAdapter.readTemplateFont', () => {
  it('reads nothing outside the font dirs and the assets dir, not even the temp dir other media may use', async () => {
    const adapter = new FilesystemNodeAdapter();

    adapter.setAssetsDir(assetsDir);
    adapter.setFontDirs([fontsDir]);

    expect(await adapter.readTemplateFont('Brand.ttf')).toEqual(new Uint8Array(fs.readFileSync(pacifico)));
    expect(await adapter.readTemplateFont(path.join(outside, 'Secret.ttf'))).toBeNull();
    expect(await adapter.readTemplateFont(path.join(os.tmpdir(), 'anything.ttf'))).toBeNull();
  });
});
