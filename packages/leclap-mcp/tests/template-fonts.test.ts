import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TemplateDescriptor } from 'ffmpeg-video-composer';

import { loadConfig } from '../src/config.js';
import { fontDirsOf, templateFontFindings } from '../src/compose/template-fonts.js';
import { registerValidateTemplate } from '../src/tools/validateTemplate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pacifico = path.resolve(here, '../../leclap-creative-kit/src/library/fonts/Pacifico.ttf');

type Handler = (
  args: Record<string, unknown>
) => Promise<{ isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> }>;

let root = '';
let mediaDir = '';
let fontsDir = '';
let outside = '';

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-mcp-fonts-')));
  mediaDir = path.join(root, 'media');
  fontsDir = path.join(root, 'fonts');
  outside = path.join(root, 'outside');
  await Promise.all([mediaDir, fontsDir, outside].map((dir) => fs.mkdir(dir)));
  await fs.copyFile(pacifico, path.join(fontsDir, 'Brand.ttf'));
  await fs.copyFile(pacifico, path.join(mediaDir, 'InMedia.ttf'));
  await fs.copyFile(pacifico, path.join(outside, 'Secret.ttf'));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function template(src: string): Record<string, unknown> {
  return {
    global: { orientation: 'landscape', musicEnabled: false, fonts: [{ family: 'Brand', src }] },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2 },
        inputs: [
          { name: 'tag', type: 'html', html: '<p>Hi</p>', css: 'p { font: 40px Brand }', width: 400, height: 100 },
        ],
      },
    ],
  };
}

function validateHandler(withFontsDir: boolean): Handler {
  let captured: Handler | undefined;
  const server = { registerTool: (_name: string, _meta: unknown, cb: Handler) => (captured = cb) };

  registerValidateTemplate(server as never, {
    mediaDir,
    outputDir: path.join(root, 'out'),
    renderTimeoutMs: 1000,
    ...(withFontsDir ? { fontsDir } : {}),
  });

  return captured as Handler;
}

describe('--fonts-dir', () => {
  afterEach(() => {
    delete process.env.LECLAP_MCP_FONTS_DIR;
  });

  it('is read from the flag, then the env, and absent by default', () => {
    expect(loadConfig([]).fontsDir).toBeUndefined();
    expect(loadConfig(['--fonts-dir', '/tmp/brand-fonts']).fontsDir).toBe('/tmp/brand-fonts');
    process.env.LECLAP_MCP_FONTS_DIR = '/tmp/env-fonts';
    expect(loadConfig([]).fontsDir).toBe('/tmp/env-fonts');
    process.env.LECLAP_MCP_FONTS_DIR = '';
    expect(loadConfig([]).fontsDir).toBeUndefined();
  });

  it('becomes the render font dir; the media dir is always one (it is the assets dir)', () => {
    expect(fontDirsOf({ mediaDir, fontsDir })).toEqual([fontsDir]);
    expect(fontDirsOf({ mediaDir })).toEqual([]);
  });
});

describe('template fonts in the MCP sandbox', () => {
  it('reads a font from the fonts dir or the media dir', async () => {
    const config = { mediaDir, fontsDir };

    expect(await templateFontFindings(template('Brand.ttf') as unknown as TemplateDescriptor, config)).toEqual([]);
    expect(await templateFontFindings(template('InMedia.ttf') as unknown as TemplateDescriptor, config)).toEqual([]);
  });

  it('refuses a font outside the allowed dirs, by absolute path or traversal', async () => {
    const config = { mediaDir, fontsDir };
    const found = await Promise.all(
      [path.join(outside, 'Secret.ttf'), '../outside/Secret.ttf'].map((src) =>
        templateFontFindings(template(src) as unknown as TemplateDescriptor, config)
      )
    );

    expect(found.map((errors) => errors.map((error) => error.code))).toEqual([['font_not_found'], ['font_not_found']]);
  });

  it('validate_template fails on a font it cannot read, with the path and the fix', async () => {
    const result = await validateHandler(false)({ template: template('Brand.ttf') });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('global.fonts[0] (Brand): "Brand.ttf" was not found');
    expect(result.structuredContent).toMatchObject({ valid: false, errors: [{ code: 'font_not_found' }] });
  });

  it('validate_template passes once the fonts dir is configured', async () => {
    const result = await validateHandler(true)({ template: template('Brand.ttf') });

    expect(result.isError).toBeUndefined();
  });
});
