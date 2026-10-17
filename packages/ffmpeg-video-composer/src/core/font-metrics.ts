// A minimal TrueType/OpenType reader: enough to measure how wide a string renders, and nothing else.
// Written in-house rather than pulling a font library because the only question asked of it is
// "how many pixels wide is this string at this size", and the answer needs two tables.
//
// Kerning is deliberately ignored. It requires `kern`/`GPOS` and almost always *narrows* a string,
// so omitting it makes every measurement slightly conservative — overflow detection errs toward
// warning rather than staying silent, which is the safe direction.
//
// Built on DataView/Uint8Array rather than Node's Buffer: this module is reached from the browser
// and React Native entry points (via TemplateValidator), and neither environment provides the
// `Buffer` global — using it here would throw `ReferenceError: Buffer is not defined` at load time.

export interface FontMetrics {
  unitsPerEm: number;
  // null means "this font has no glyph for that code point" — distinct from a glyph whose advance is
  // legitimately 0 (a combining mark). Callers must not treat the two the same: summing a missing
  // glyph as 0 reports a confident width of 0 for a string the font cannot render at all.
  advanceWidth(codePoint: number): number | null;
}

export interface TableRecord {
  offset: number;
  length: number;
}

// 4-byte ASCII table tag. Built from code points rather than TextDecoder: table tags are ASCII by
// spec, and String.fromCodePoint needs no runtime API beyond the language itself.
function readTag(bytes: Uint8Array, offset: number): string {
  return String.fromCodePoint(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function readTableDirectory(view: DataView, bytes: Uint8Array): Map<string, TableRecord> | null {
  // 12-byte offset table, then 16 bytes per table record.
  if (view.byteLength < 12) {
    return null;
  }

  const numTables = view.getUint16(4, false);
  const tables = new Map<string, TableRecord>();

  if (view.byteLength < 12 + numTables * 16) {
    return null;
  }

  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    const tag = readTag(bytes, base);

    tables.set(tag, { offset: view.getUint32(base + 8, false), length: view.getUint32(base + 12, false) });
  }

  return tables;
}

interface CmapSegment {
  start: number;
  end: number;
  delta: number;
  rangeOffset: number;
  rangeOffsetFieldAddress: number;
}

// One segment's worth of code -> glyph entries. Split out of readCmapFormat4 purely to keep that
// function's statement count down; the logic is the direct format-4 lookup algorithm.
function resolveSegmentGlyphs(view: DataView, segment: CmapSegment, map: Map<number, number>): void {
  const { start, end, delta, rangeOffset, rangeOffsetFieldAddress } = segment;

  // Glyph 0 is `.notdef` — the empty box a font draws for a character it does not have. Per the
  // format-4 spec that is the "missing" answer, so it is left OUT of the map rather than recorded as
  // a mapping: recording it would make `advanceWidth` hand back the .notdef advance as if it were a
  // real measurement, and the whole point of the null return is that an unrenderable string cannot
  // be measured.
  for (let code = start; code <= end && code !== 0xffff; code++) {
    if (rangeOffset === 0) {
      const glyph = (code + delta) & 0xffff;

      if (glyph !== 0) {
        map.set(code, glyph);
      }

      continue;
    }

    const glyphAddress = rangeOffsetFieldAddress + rangeOffset + (code - start) * 2;

    if (glyphAddress + 1 >= view.byteLength) {
      continue;
    }

    const glyph = view.getUint16(glyphAddress, false);

    if (glyph !== 0) {
      map.set(code, (glyph + delta) & 0xffff);
    }
  }
}

// cmap format 4: the segmented mapping every Latin font ships. Other formats are not read; a font
// exposing only format 0/6/12 yields an empty map, and `parseFontMetrics` turns that into a null
// return so the caller falls back to the estimate rather than measuring against an empty table.
function readCmapFormat4(view: DataView, offset: number): Map<number, number> {
  const map = new Map<number, number>();
  const segCountX2 = view.getUint16(offset + 6, false);
  // Floor rather than trust the division: `segCountX2` is untrusted, and an odd value would make
  // `segCount` fractional, running the loop one extra time past the end of every segment array.
  const segCount = Math.floor(segCountX2 / 2);

  const endCodes = offset + 14;
  const startCodes = endCodes + segCountX2 + 2; // +2 skips reservedPad
  const idDeltas = startCodes + segCountX2;
  const idRangeOffsets = idDeltas + segCountX2;

  // Every one of the four segment arrays is sized from `segCountX2`, so a truncated or malformed
  // subtable would drive `getUint16` past the buffer and throw RangeError out of `parseFontMetrics`
  // — whose contract, and whose own test, say it returns null instead. One check covers all four.
  if (idRangeOffsets + segCountX2 > view.byteLength) {
    return map;
  }

  for (let seg = 0; seg < segCount; seg++) {
    const start = view.getUint16(startCodes + seg * 2, false);
    const end = view.getUint16(endCodes + seg * 2, false);

    if (start > end) {
      continue;
    }

    resolveSegmentGlyphs(
      view,
      {
        start,
        end,
        delta: view.getInt16(idDeltas + seg * 2, false),
        rangeOffset: view.getUint16(idRangeOffsets + seg * 2, false),
        rangeOffsetFieldAddress: idRangeOffsets + seg * 2,
      },
      map
    );
  }

  return map;
}

// Unicode-keyed encodings, in the order the spec recommends preferring them: Windows BMP, Windows
// full repertoire, then the platform-independent Unicode entries. A symbol face's (3,0) subtable is
// also format 4, but it is keyed on the U+F000 private-use block — taking the first format-4 subtable
// found would key the map on codes no caption contains, so every character would miss and a
// perfectly measurable string would silently fall back to the estimate.
function isUnicodeEncoding(platformId: number, encodingId: number): boolean {
  if (platformId === 3) {
    return encodingId === 1 || encodingId === 10;
  }

  return platformId === 0;
}

export function readCmap(view: DataView, table: TableRecord): Map<number, number> {
  const numSubtables = view.getUint16(table.offset + 2, false);

  for (let i = 0; i < numSubtables; i++) {
    const record = table.offset + 4 + i * 8;

    if (record + 8 > view.byteLength) {
      continue;
    }

    if (!isUnicodeEncoding(view.getUint16(record, false), view.getUint16(record + 2, false))) {
      continue;
    }

    const subtableOffset = table.offset + view.getUint32(record + 4, false);

    if (subtableOffset + 14 > view.byteLength) {
      continue;
    }

    if (view.getUint16(subtableOffset, false) === 4) {
      return readCmapFormat4(view, subtableOffset);
    }
  }

  return new Map();
}

interface AdvanceWidths {
  // In font units, one per glyph up to `numberOfHMetrics`.
  widths: number[];
  // Glyphs past `numberOfHMetrics` reuse the final advance — how monospaced tails are stored.
  fallback: number;
}

// hmtx holds exactly `numberOfHMetrics` advance widths. Null when it does not.
//
// Stopping early on a short table is not an option: `fallback` is the last width read, and it stands
// in for every glyph past `numberOfHMetrics`. A table truncated mid-way would therefore hand an
// arbitrary glyph's advance to the entire tail of the font. Measured on a real Rubik.ttf with a
// relocated hmtx record, that turned a 2302px headline into a 218330px one — reported, because the
// font "parsed", as an exact measurement. Refusing to parse degrades to the estimate instead.
function readAdvanceWidths(view: DataView, hmtx: TableRecord, numberOfHMetrics: number): AdvanceWidths | null {
  // Bounded against the TABLE, not the file. `view.byteLength` alone is no check at all in the
  // normal sfnt layout, where hmtx sorts before loca/maxp/name/post: a truncated hmtx still "fits"
  // inside the file, so the reader walks straight into the following tables and returns their bytes
  // as advance widths — with `fallback` standing in for the whole tail of the font. That is exactly
  // the 2302px-headline-becomes-218330px failure this function was written to refuse, reported as an
  // exact measurement. `hmtx.length` was parsed into TableRecord and then never read.
  if (
    numberOfHMetrics < 1 ||
    numberOfHMetrics * 4 > hmtx.length ||
    hmtx.offset + numberOfHMetrics * 4 > view.byteLength
  ) {
    return null;
  }

  const widths: number[] = [];

  for (let i = 0; i < numberOfHMetrics; i++) {
    widths.push(view.getUint16(hmtx.offset + i * 4, false));
  }

  return { widths, fallback: widths[numberOfHMetrics - 1] };
}

// Each table this reader touches must hold the fields it is about to read: head's unitsPerEm at +18,
// hhea's numberOfHMetrics at +34, and cmap's subtable count at +2.
function tablesAreReadable(view: DataView, head: TableRecord, hhea: TableRecord, cmap: TableRecord): boolean {
  return (
    head.offset + 20 <= view.byteLength && hhea.offset + 36 <= view.byteLength && cmap.offset + 4 <= view.byteLength
  );
}

// Accepts any Uint8Array (a Node Buffer included, since Buffer extends Uint8Array — but this
// module never depends on that; it only ever touches the Uint8Array/DataView surface). A DataView
// is constructed over the exact byteOffset/byteLength of the input rather than its `.buffer`
// directly, because a Uint8Array may be a view into a larger, shared ArrayBuffer — reading from
// `.buffer` alone would read the right bytes at the wrong place whenever byteOffset isn't 0.
export function parseFontMetrics(bytes: Uint8Array): FontMetrics | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = readTableDirectory(view, bytes);

  if (!tables) {
    return null;
  }

  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  const cmap = tables.get('cmap');

  if (!head || !hhea || !hmtx || !cmap || !tablesAreReadable(view, head, hhea, cmap)) {
    return null;
  }

  const unitsPerEm = view.getUint16(head.offset + 18, false);
  const advances = readAdvanceWidths(view, hmtx, view.getUint16(hhea.offset + 34, false));

  if (unitsPerEm === 0 || !advances) {
    return null;
  }

  const charToGlyph = readCmap(view, cmap);

  // An empty map means the character-to-glyph table was unreadable — a format this reader does not
  // handle, or a malformed one. Every lookup would miss, so hand back "no metrics" once rather than
  // a metrics object that answers null to everything.
  if (charToGlyph.size === 0) {
    return null;
  }

  const { widths, fallback } = advances;

  return {
    unitsPerEm,
    advanceWidth(codePoint: number): number | null {
      const glyph = charToGlyph.get(codePoint);

      if (glyph === undefined) {
        return null;
      }

      return widths[glyph] ?? fallback;
    },
  };
}

// Null when the font cannot render some code point in `text`. Returning a number there would be a
// lie dressed as a measurement: a Latin-only face has no glyph for a CJK caption, so every advance
// would be absent, the sum would be 0, and a caller that trusts the number would conclude the text
// fits in any frame and cannot collide with anything (a zero-width box overlaps nothing).
export function measureTextWidth(metrics: FontMetrics, text: string, fontSizePx: number): number | null {
  let units = 0;

  for (const char of text) {
    const advance = metrics.advanceWidth(char.codePointAt(0) as number);

    if (advance === null) {
      return null;
    }

    units += advance;
  }

  return (units / metrics.unitsPerEm) * fontSizePx;
}

/** A face's hhea ascender and descender as fractions of its size (both positive), and its weight class. */
export interface VerticalMetrics {
  ascent: number;
  descent: number;
  /** OS/2 usWeightClass: the weight drawtext draws (a variable face's default instance); 400 without OS/2. */
  weight: number;
}

const REGULAR_WEIGHT = 400;

// The line metrics Satori lays text out with (opentype's ascender / descender: hhea), so a caption raster
// can put its baseline exactly where drawtext puts it, and the weight drawtext draws the face at, so the
// raster's glyphs have the widths the caption was laid out with. Null when the tables are missing or unreadable.
function readWeightClass(view: DataView, os2: { offset: number } | undefined): number {
  if (!os2 || os2.offset + 6 > view.byteLength) return REGULAR_WEIGHT;

  return view.getUint16(os2.offset + 4, false) || REGULAR_WEIGHT;
}

export function parseVerticalMetrics(bytes: Uint8Array): VerticalMetrics | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = readTableDirectory(view, bytes);
  const head = tables?.get('head');
  const hhea = tables?.get('hhea');

  if (!head || !hhea || head.offset + 20 > view.byteLength || hhea.offset + 8 > view.byteLength) return null;

  const unitsPerEm = view.getUint16(head.offset + 18, false);

  if (unitsPerEm === 0) return null;

  return {
    ascent: view.getInt16(hhea.offset + 4, false) / unitsPerEm,
    descent: -view.getInt16(hhea.offset + 6, false) / unitsPerEm,
    weight: readWeightClass(view, tables?.get('OS/2')),
  };
}
