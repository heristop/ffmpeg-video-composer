import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFontMetrics, measureTextWidth, parseVerticalMetrics } from '@/core/font-metrics';

const currentDir = dirname(fileURLToPath(import.meta.url));
// Rubik is the engine's DEFAULT_FONT_ID and already lives in creative-kit; the assertions below
// are ratios, not absolute pixel counts, so any bundled .ttf would work equally well.
const fontPath = join(currentDir, '../../leclap-creative-kit/src/library/fonts/Rubik.ttf');

// A hand-built, minimal sfnt buffer: a structurally valid table directory (offset table +
// head/hhea/hmtx/cmap records) that parses far enough to reach readCmap, but whose cmap record's
// offset points past the end of the buffer. head/hhea/hmtx are laid out with real, in-bounds data
// so parseFontMetrics gets past every earlier guard and only the cmap read is exercised.
function bufferWithOutOfBoundsCmap(): Buffer {
  const buffer = Buffer.alloc(132);

  buffer.writeUInt16BE(4, 4); // numTables

  const writeRecord = (index: number, tag: string, offset: number, length: number): void => {
    const base = 12 + index * 16;

    buffer.write(tag, base, 'ascii');
    buffer.writeUInt32BE(offset, base + 8);
    buffer.writeUInt32BE(length, base + 12);
  };

  writeRecord(0, 'head', 76, 20);
  writeRecord(1, 'hhea', 96, 36);
  writeRecord(2, 'hmtx', 132, 0);
  writeRecord(3, 'cmap', 9999, 0); // out of bounds: buffer is only 132 bytes long

  buffer.writeUInt16BE(1000, 76 + 18); // head.unitsPerEm
  buffer.writeUInt16BE(0, 96 + 34); // hhea.numberOfHMetrics — 0, so hmtx is never read

  return buffer;
}

// A structurally valid sfnt whose cmap subtable IS format 4 and in bounds, but whose `segCountX2`
// claims far more segments than the buffer holds. The subtable-level guard only proves the 14-byte
// header fits; the four segment arrays live past it.
function bufferWithOversizedCmapSegments(): Buffer {
  const buffer = Buffer.alloc(200);

  buffer.writeUInt16BE(4, 4); // numTables

  const writeRecord = (index: number, tag: string, offset: number, length: number): void => {
    const base = 12 + index * 16;

    buffer.write(tag, base, 'ascii');
    buffer.writeUInt32BE(offset, base + 8);
    buffer.writeUInt32BE(length, base + 12);
  };

  writeRecord(0, 'head', 76, 20);
  writeRecord(1, 'hhea', 96, 36);
  writeRecord(2, 'hmtx', 132, 4);
  writeRecord(3, 'cmap', 140, 40);

  buffer.writeUInt16BE(1000, 76 + 18); // head.unitsPerEm
  buffer.writeUInt16BE(1, 96 + 34); // hhea.numberOfHMetrics
  buffer.writeUInt16BE(500, 132); // the single hmtx advance

  buffer.writeUInt16BE(1, 142); // cmap.numSubtables
  buffer.writeUInt32BE(20, 148); // subtable at 140 + 20 = 160
  buffer.writeUInt16BE(4, 160); // subtable format
  buffer.writeUInt16BE(0xffff, 166); // segCountX2 — 32767.5 segments in a 200-byte buffer

  return buffer;
}

// Same shape, but `hhea` promises 40 advance records and `hmtx` has room for far fewer.
function bufferWithTruncatedHmtx(): Buffer {
  const buffer = bufferWithOversizedCmapSegments();

  buffer.writeUInt16BE(4, 166); // a sane segCountX2 so cmap is no longer the reason it fails
  buffer.writeUInt16BE(40, 96 + 34); // hhea.numberOfHMetrics — 160 bytes of hmtx from offset 132

  return buffer;
}

describe('font metrics', () => {
  it('returns null for a buffer that is not a font', () => {
    expect(parseFontMetrics(Buffer.from('not a font at all'))).toBeNull();
  });

  it('reads a plausible unitsPerEm', () => {
    const metrics = parseFontMetrics(readFileSync(fontPath));

    expect(metrics).not.toBeNull();
    // Every real TTF uses a power of two here, almost always 1000, 1024 or 2048.
    expect(metrics!.unitsPerEm).toBeGreaterThanOrEqual(16);
    expect(metrics!.unitsPerEm).toBeLessThanOrEqual(16384);
  });

  it('measures a wider string as wider', () => {
    const metrics = parseFontMetrics(readFileSync(fontPath))!;

    const short = measureTextWidth(metrics, 'ii', 48)!;
    const long = measureTextWidth(metrics, 'WWWWWWWW', 48)!;

    expect(long).toBeGreaterThan(short);
  });

  it('scales linearly with font size', () => {
    const metrics = parseFontMetrics(readFileSync(fontPath))!;

    const at24 = measureTextWidth(metrics, 'Hello world', 24)!;
    const at48 = measureTextWidth(metrics, 'Hello world', 48)!;

    expect(at48).toBeCloseTo(at24 * 2, 5);
  });

  it('reports an unmapped code point as null rather than as a zero-width glyph', () => {
    const metrics = parseFontMetrics(readFileSync(fontPath))!;

    expect(() => measureTextWidth(metrics, '\u{10FFFF}', 48)).not.toThrow();
    expect(metrics.advanceWidth(0x10ffff)).toBeNull();
  });

  it('refuses to measure a string the font cannot render, instead of summing missing glyphs to 0', () => {
    // Rubik has no CJK coverage. A 0 here would read as "this text fits any frame and overlaps
    // nothing", so every geometry rule would stay silent on a caption that runs clean off screen.
    const metrics = parseFontMetrics(readFileSync(fontPath))!;

    expect(measureTextWidth(metrics, '这是一个非常长的中文标题', 96)).toBeNull();
    expect(measureTextWidth(metrics, 'Hello world', 96)).toBeGreaterThan(0);
  });

  it('returns null rather than throwing when a cmap format-4 subtable declares more segments than it holds', () => {
    const buffer = bufferWithOversizedCmapSegments();

    expect(() => parseFontMetrics(buffer)).not.toThrow();
    expect(parseFontMetrics(buffer)).toBeNull();
  });

  it('returns null when hmtx holds fewer records than hhea promised', () => {
    // Stopping early instead would leave the last successfully-read advance standing in for every
    // glyph past the cut — measured on a real font, a 2302px headline became a 218330px one, and it
    // was reported as an exact measurement.
    const buffer = bufferWithTruncatedHmtx();

    expect(parseFontMetrics(buffer)).toBeNull();
  });

  it('bounds hmtx against the table length, not the whole file', () => {
    // hmtx normally sorts before loca/maxp/name/post, so a truncated hmtx still "fits" inside the
    // file and the reader walks straight into the following tables, returning their bytes as advance
    // widths — with `fallback` standing in for the entire tail of the font. Checking only
    // `view.byteLength` is no check at all in that layout. `hmtx.length` says how long it really is.
    const buffer = readFileSync(fontPath);
    const truncated = Buffer.from(buffer);
    const numTables = truncated.readUInt16BE(4);

    for (let i = 0; i < numTables; i++) {
      const base = 12 + i * 16;

      if (truncated.toString('ascii', base, base + 4) === 'hmtx') {
        truncated.writeUInt32BE(8, base + 12); // claim the table is 8 bytes long
      }
    }

    expect(parseFontMetrics(buffer)).not.toBeNull();
    expect(parseFontMetrics(truncated)).toBeNull();
  });

  it('returns null rather than throwing when the cmap record points past the end of the buffer', () => {
    const buffer = bufferWithOutOfBoundsCmap();

    expect(() => parseFontMetrics(buffer)).not.toThrow();
    expect(parseFontMetrics(buffer)).toBeNull();
  });

  it('parses identically from a Uint8Array view at a non-zero offset into a larger buffer', () => {
    const fontBytes = readFileSync(fontPath);
    const padding = 17; // arbitrary, non-zero and not 4-byte aligned
    const padded = new Uint8Array(padding + fontBytes.byteLength + padding);

    padded.set(fontBytes, padding);

    const view = new Uint8Array(padded.buffer, padding, fontBytes.byteLength);

    const direct = parseFontMetrics(fontBytes)!;
    const fromView = parseFontMetrics(view)!;

    expect(fromView).not.toBeNull();
    expect(fromView.unitsPerEm).toBe(direct.unitsPerEm);
    expect(measureTextWidth(fromView, 'Hello world', 48)).toBe(measureTextWidth(direct, 'Hello world', 48));
  });

  it('reads the hhea ascender and descender as fractions of the size, and the weight class', () => {
    // Rubik: unitsPerEm 1000, hhea ascender 935, descender -250; a variable face whose default instance
    // (what drawtext draws) is its 300 Light.
    expect(parseVerticalMetrics(readFileSync(fontPath))).toEqual({ ascent: 0.935, descent: 0.25, weight: 300 });
    expect(parseVerticalMetrics(new Uint8Array(8))).toBeNull();
  });
});
