import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layerFonts, resolveFontStack } from '@/core/html/html-fonts';
import type { LayerElement } from '@/core/html/html-element';
import { parseStylesheet } from '@/core/html/css-parse';
import {
  TEMPLATE_FONT_MAX_BYTES,
  declaredFontFormat,
  fontFormatOf,
  templateFontSpecs,
  type TemplateFontError,
} from '@/core/html/template-fonts';
import { decodeFontDataUri, loadTemplateFonts, templateFontFile, toSfnt } from '@/core/html/template-font-load';
import { bytesToBase64 } from '@/editor/html/base64';
import { ttfToWoff } from './fixtures/woff';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(here, '../../leclap-creative-kit/src/library/fonts');
const pacifico = new Uint8Array(fs.readFileSync(path.join(fontsDir, 'Pacifico.ttf')));

function tables(sfnt: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);

  return new Map(
    Array.from({ length: view.getUint16(4) }, (_, index) => {
      const at = 12 + index * 16;
      const tag = String.fromCodePoint(sfnt[at], sfnt[at + 1], sfnt[at + 2], sfnt[at + 3]);

      return [tag, sfnt.slice(view.getUint32(at + 8), view.getUint32(at + 8) + view.getUint32(at + 12))];
    })
  );
}

async function failure(promise: Promise<unknown>): Promise<TemplateFontError> {
  try {
    await promise;
  } catch (error) {
    return error as TemplateFontError;
  }

  throw new Error('expected a failure');
}

describe('template font formats', () => {
  it('tells the font containers apart by their first bytes', () => {
    expect(fontFormatOf(pacifico)).toBe('ttf');
    expect(fontFormatOf(new TextEncoder().encode('OTTO....'))).toBe('otf');
    expect(fontFormatOf(new TextEncoder().encode('wOFF....'))).toBe('woff');
    expect(fontFormatOf(new TextEncoder().encode('wOF2....'))).toBe('woff2');
    expect(fontFormatOf(new TextEncoder().encode('<html>'))).toBeNull();
  });

  it('reads what a src declares from its extension or media type', () => {
    expect(declaredFontFormat('fonts/Ubuntu-Regular.ttf')).toBe('ttf');
    expect(declaredFontFormat('/abs/Brand.OTF')).toBe('otf');
    expect(declaredFontFormat('Brand.woff2')).toBe('woff2');
    expect(declaredFontFormat('Brand.png')).toBe('unknown');
    expect(declaredFontFormat('data:font/woff;base64,AAAA')).toBe('woff');
    expect(declaredFontFormat('data:application/octet-stream;base64,AAAA')).toBeNull();
    expect(declaredFontFormat('data:image/png;base64,AAAA')).toBe('unknown');
    expect(declaredFontFormat('data:font/ttf,plain')).toBe('unknown');
  });

  it('unpacks a WOFF file to the very tables of the TrueType font it wraps', () => {
    const woff = ttfToWoff(pacifico);
    const sfnt = toSfnt(woff);

    expect(woff.byteLength).toBeLessThan(pacifico.byteLength);
    expect(fontFormatOf(sfnt)).toBe('ttf');
    expect(tables(sfnt)).toEqual(tables(pacifico));
  });

  it('keeps TrueType and OpenType bytes as they are', () => {
    expect(toSfnt(pacifico)).toBe(pacifico);
  });

  it('refuses WOFF2 with the command that converts it', () => {
    expect(() => toSfnt(new TextEncoder().encode('wOF2 and more bytes'))).toThrow(
      /WOFF2.*fonttools ttLib\.woff2 decompress/
    );
  });

  it('refuses a file that is no font, and a damaged WOFF', () => {
    expect(() => toSfnt(new TextEncoder().encode('<!doctype html>'))).toThrow(/not a TrueType, OpenType or WOFF/);
    expect(() => toSfnt(ttfToWoff(pacifico).slice(0, 200))).toThrow(/damaged WOFF/);
  });

  it('refuses a WOFF whose directory claims more than the size limit, before inflating it', () => {
    const woff = ttfToWoff(pacifico);
    new DataView(woff.buffer).setUint32(44 + 12, TEMPLATE_FONT_MAX_BYTES * 5);

    expect(() => toSfnt(woff)).toThrow(/limit/);
  });

  it('decodes a base64 data URI and refuses one over the size limit before decoding it', () => {
    expect(decodeFontDataUri(`data:font/ttf;base64,${bytesToBase64(pacifico)}`)).toEqual(pacifico);
    expect(() => decodeFontDataUri(`data:font/ttf;base64,${'A'.repeat(TEMPLATE_FONT_MAX_BYTES * 2)}`)).toThrow(/limit/);
    expect(() => decodeFontDataUri('data:font/ttf,not-base64')).toThrow(/base64 data URI/);
  });
});

describe('loadTemplateFonts', () => {
  const specs = [{ family: 'Brand', src: 'fonts/Brand.ttf', weight: 700 }];

  it('loads each declared face, named by the hash of its bytes', async () => {
    const [face] = await loadTemplateFonts(specs, async () => pacifico);

    expect(face).toMatchObject({ family: 'Brand', weight: 700, file: templateFontFile(pacifico) });
    expect(face.file).toMatch(/^template-[0-9a-f]{16}\.ttf$/);
    expect(face.data).toBe(pacifico);
  });

  it('names the same bytes the same way, from a file or a data URI, and an unpacked WOFF the same on every load', async () => {
    const [ttf] = await loadTemplateFonts(specs, async () => pacifico);
    const [inline] = await loadTemplateFonts(
      [{ family: 'Brand', src: `data:font/ttf;base64,${bytesToBase64(pacifico)}` }],
      async () => null
    );
    const woff = ttfToWoff(pacifico);
    const [first] = await loadTemplateFonts(specs, async () => woff);
    const [second] = await loadTemplateFonts(specs, async () => woff.slice());

    expect(inline.file).toBe(ttf.file);
    expect(second.file).toBe(first.file);
    expect(second.data).toEqual(first.data);
  });

  it('never asks the host to read a data URI', async () => {
    const reads: string[] = [];

    await loadTemplateFonts(
      [{ family: 'Brand', src: `data:font/ttf;base64,${bytesToBase64(pacifico)}` }],
      async (src) => {
        reads.push(src);

        return null;
      }
    );

    expect(reads).toEqual([]);
  });

  it('names the declaration a missing, unreadable or WOFF2 file came from', async () => {
    const missing = await failure(loadTemplateFonts(specs, async () => null));
    const broken = await failure(
      loadTemplateFonts(specs, async () => {
        throw new Error('EACCES');
      })
    );
    const woff2 = await failure(loadTemplateFonts(specs, async () => new TextEncoder().encode('wOF2xxxx')));

    expect([missing.code, broken.code, woff2.code]).toEqual([
      'font_not_found',
      'font_unreadable',
      'font_woff2_unsupported',
    ]);
    expect(missing.message).toMatch(/^global\.fonts\[0\] \(Brand\): "fonts\/Brand\.ttf" was not found/);
    expect(broken.message).toContain('EACCES');
  });
});

describe('template fonts in layout', () => {
  const custom = [
    { family: 'Ubuntu', file: 'template-aaaa.ttf', weight: 400 },
    { family: 'Ubuntu', file: 'template-bbbb.ttf', weight: 700 },
    { family: 'Oswald', file: 'template-cccc.ttf' },
  ];

  it('resolves a declared family first, whatever its case, and wins over a bundled family of the same name', () => {
    expect(resolveFontStack('"ubuntu", sans-serif', custom)).toEqual({ family: 'Ubuntu', unknown: [] });
    expect(resolveFontStack('Oswald', custom)).toEqual({ family: 'Oswald', unknown: [] });
    expect(resolveFontStack('Nope, Ubuntu', custom)).toEqual({ family: 'Ubuntu', unknown: ['Nope'] });
  });

  it('loads every declared face of a family a layer uses, and the bundled one when no template face is named', () => {
    const root: LayerElement = {
      type: 'div',
      props: {
        style: { fontFamily: 'Rubik' },
        children: [
          { type: 'p', props: { style: { fontFamily: 'Ubuntu' }, children: ['A'] } },
          { type: 'p', props: { style: { fontFamily: 'Oswald' }, children: ['B'] } },
        ],
      },
    };

    expect(layerFonts(root, 'Rubik', custom).faces).toEqual([
      { family: 'Oswald', file: 'template-cccc.ttf', weights: [400, 700] },
      { family: 'Rubik', file: 'Rubik.ttf', weights: [400, 700] },
      { family: 'Ubuntu', file: 'template-aaaa.ttf', weights: [400, 700], weight: 400 },
      { family: 'Ubuntu', file: 'template-bbbb.ttf', weights: [400, 700], weight: 700 },
    ]);
    expect(layerFonts(root, 'Rubik').faces.map((face) => face.file)).toEqual(['Oswald.ttf', 'Rubik.ttf']);
  });

  it('reads the declarations of a global, skipping malformed ones', () => {
    expect(
      templateFontSpecs({
        fonts: [{ family: ' Ubuntu ', src: 'a.ttf', weight: 700, style: 'italic' }, { family: 'Broken' }, 'nope'],
      })
    ).toEqual([{ family: 'Ubuntu', src: 'a.ttf', weight: 700, style: 'italic' }]);
    expect(templateFontSpecs(undefined)).toEqual([]);
  });

  it('keeps refusing @font-face, and says where a font is declared instead', () => {
    const { findings } = parseStylesheet('@font-face { font-family: X; src: url(x.ttf) } p { color: red }');

    expect(findings.map((finding) => finding.message)).toEqual([
      'css @font-face: at-rules are not supported; declare the font in global.fonts ({ family, src }) and name its family in font-family',
    ]);
  });
});
