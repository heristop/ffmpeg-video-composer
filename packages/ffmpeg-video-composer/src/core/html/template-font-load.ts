// Loading a template's fonts (`global.fonts`, template-fonts.ts): the bytes of each declared face, read by the
// host or decoded from a data URI, size-checked, WOFF unpacked to its sfnt with the engine's own pure-JS inflate
// (template-link/inflate-js.ts), WOFF2 refused, and the face named by the hash of its sfnt. Apart from the
// declarations so validation and the browser's eager bundle carry none of it.

import { inflateRawJs } from '../template-link/inflate-js';
import { sha256Hex } from '../determinism/sha256';
import { base64ToBytes } from '../../editor/html/base64';
import {
  FONT_DATA_URI,
  TEMPLATE_FONT_MAX_BYTES,
  TemplateFontError,
  WOFF2_CONVERT_HINT,
  fontFormatOf,
  fontTag,
  isFontDataUri,
  type TemplateFontFace,
  type TemplateFontSpec,
} from './template-fonts';

/** The bytes of a base64 `data:` URI, size-checked before they are decoded. */
export function decodeFontDataUri(src: string): Uint8Array {
  const header = FONT_DATA_URI.exec(src);

  if (!header) throw new TemplateFontError('font_unreadable', 'is not a base64 data URI (data:font/ttf;base64,…)');

  const payload = src.slice(header[0].length);

  if (Math.floor((payload.length * 3) / 4) > TEMPLATE_FONT_MAX_BYTES) throw tooLarge();

  return base64ToBytes(payload);
}

function tooLarge(): TemplateFontError {
  return new TemplateFontError(
    'font_too_large',
    `is over the ${TEMPLATE_FONT_MAX_BYTES / (1024 * 1024)} MB limit for a template font: subset it to the scripts the template uses`
  );
}

function sfntHeader(view: DataView, flavor: number, numTables: number): void {
  let power = 1;
  let log = 0;

  while (power * 2 <= numTables) {
    power *= 2;
    log++;
  }

  view.setUint32(0, flavor);
  view.setUint16(4, numTables);
  view.setUint16(6, power * 16);
  view.setUint16(8, log);
  view.setUint16(10, numTables * 16 - power * 16);
}

interface WoffTable {
  tag: number;
  offset: number;
  compLength: number;
  origLength: number;
  checksum: number;
}

function damagedWoff(): TemplateFontError {
  return new TemplateFontError('font_unreadable', 'is a damaged WOFF file');
}

function woffDirectory(woff: Uint8Array, view: DataView): WoffTable[] {
  const numTables = view.getUint16(12);

  if (44 + numTables * 20 > woff.byteLength) throw damagedWoff();

  return Array.from({ length: numTables }, (_, index) => {
    const at = 44 + index * 20;

    return {
      tag: view.getUint32(at),
      offset: view.getUint32(at + 4),
      compLength: view.getUint32(at + 8),
      origLength: view.getUint32(at + 12),
      checksum: view.getUint32(at + 16),
    };
  });
}

// One table's bytes, inflated into a buffer of exactly the size the directory declares.
function woffTableData(woff: Uint8Array, entry: WoffTable): Uint8Array {
  if (entry.offset + entry.compLength > woff.byteLength || entry.compLength > entry.origLength) throw damagedWoff();

  const stored = woff.subarray(entry.offset, entry.offset + entry.compLength);

  if (entry.compLength === entry.origLength) return stored;

  const data = inflate(stored, entry.origLength);

  if (data?.byteLength !== entry.origLength) throw damagedWoff();

  return data;
}

// A WOFF table is a zlib stream: a 2-byte header, raw DEFLATE, a 4-byte checksum. Inflated within the size
// the directory declares, so a table cannot unpack past it.
function inflate(stored: Uint8Array, size: number): Uint8Array | null {
  try {
    return stored.byteLength < 6 ? null : inflateRawJs(stored.subarray(2, -4), size);
  } catch {
    return null;
  }
}

function writeSfnt(flavor: number, tables: { entry: WoffTable; data: Uint8Array }[], size: number): Uint8Array {
  const sfnt = new Uint8Array(size);
  const out = new DataView(sfnt.buffer);
  let offset = 12 + tables.length * 16;

  sfntHeader(out, flavor, tables.length);

  for (const [index, { entry, data }] of tables.entries()) {
    const record = 12 + index * 16;

    out.setUint32(record, entry.tag);
    out.setUint32(record + 4, entry.checksum);
    out.setUint32(record + 8, offset);
    out.setUint32(record + 12, data.byteLength);
    sfnt.set(data, offset);
    offset += (data.byteLength + 3) & ~3;
  }

  return sfnt;
}

/** A WOFF (1.0) file unpacked to the TrueType/OpenType file it wraps. */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  if (woff.byteLength < 44 || fontTag(woff) !== 'wOFF') throw damagedWoff();

  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  const entries = woffDirectory(woff, view);
  // The unpacked size is checked from the directory before anything is inflated: a small file that
  // claims a huge table is refused, not decompressed.
  const size = entries.reduce((total, entry) => total + ((entry.origLength + 3) & ~3), 12 + entries.length * 16);

  if (size > TEMPLATE_FONT_MAX_BYTES * 4) throw tooLarge();

  const tables = entries.map((entry) => ({ entry, data: woffTableData(woff, entry) }));

  return writeSfnt(view.getUint32(4), tables, size);
}

/** A font file as Satori and HarfBuzz read it: TrueType/OpenType kept, WOFF unpacked, WOFF2 and the rest refused. */
export function toSfnt(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength > TEMPLATE_FONT_MAX_BYTES) throw tooLarge();

  const format = fontFormatOf(bytes);

  if (format === 'ttf' || format === 'otf') return bytes;

  if (format === 'woff') return woffToSfnt(bytes);

  if (format === 'woff2') {
    throw new TemplateFontError(
      'font_woff2_unsupported',
      `is WOFF2, which HTML layers cannot read: ${WOFF2_CONVERT_HINT}`
    );
  }

  throw new TemplateFontError('font_format', 'is not a TrueType, OpenType or WOFF font (.ttf, .otf, .woff)');
}

/** The name a loaded face goes by: the hash of its sfnt, so the same bytes always name the same layers. */
export function templateFontFile(sfnt: Uint8Array): string {
  return `template-${sha256Hex(sfnt).slice(0, 16)}.ttf`;
}

/**
 * Reads a `src` that is not a data URI: the bytes, or null when the host finds no such file within the
 * roots it allows. Expected to refuse a file over TEMPLATE_FONT_MAX_BYTES with font_too_large before reading it.
 */
export type TemplateFontReader = (src: string) => Promise<Uint8Array | null>;

function located(spec: TemplateFontSpec, index: number, error: TemplateFontError): TemplateFontError {
  const where = isFontDataUri(spec.src) ? 'its data URI' : `"${spec.src}"`;

  return new TemplateFontError(error.code, `global.fonts[${index}] (${spec.family}): ${where} ${error.message}`);
}

async function loadOne(spec: TemplateFontSpec, index: number, read: TemplateFontReader): Promise<TemplateFontFace> {
  try {
    const bytes = isFontDataUri(spec.src) ? decodeFontDataUri(spec.src) : await read(spec.src);

    if (bytes === null) {
      throw new TemplateFontError(
        'font_not_found',
        'was not found: a relative src resolves against the font roots and the assets dir, an absolute one must be inside them'
      );
    }

    const data = toSfnt(bytes);

    return {
      family: spec.family,
      file: templateFontFile(data),
      data,
      ...(spec.weight !== undefined && { weight: spec.weight }),
      ...(spec.style !== undefined && { style: spec.style }),
    };
  } catch (error) {
    const failure =
      error instanceof TemplateFontError
        ? error
        : new TemplateFontError(
            'font_unreadable',
            `could not be read (${error instanceof Error ? error.message : String(error)})`
          );

    throw located(spec, index, failure);
  }
}

/** Every declared face loaded, in declaration order; the first that cannot be throws a TemplateFontError naming it. */
export function loadTemplateFonts(
  specs: readonly TemplateFontSpec[],
  read: TemplateFontReader
): Promise<TemplateFontFace[]> {
  return Promise.all(specs.map((spec, index) => loadOne(spec, index, read)));
}

/** Each declared face loaded or the error it fails with, for validation to report every one. */
export async function checkTemplateFonts(
  specs: readonly TemplateFontSpec[],
  read: TemplateFontReader
): Promise<{ index: number; error: TemplateFontError }[]> {
  const results = await Promise.all(
    specs.map(async (spec, index) => {
      try {
        await loadOne(spec, index, read);

        return null;
      } catch (error) {
        return { index, error: error as TemplateFontError };
      }
    })
  );

  return results.filter((result): result is { index: number; error: TemplateFontError } => result !== null);
}
