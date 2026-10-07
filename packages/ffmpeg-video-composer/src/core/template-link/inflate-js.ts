// A small raw-DEFLATE (RFC 1951) decoder for runtimes without DecompressionStream (Hermes). It follows
// zlib's reference decoder, puff.c: canonical Huffman tables decoded bit by bit. Slow next to the
// platform stream, which is fine for a template-sized payload; it never runs where the stream exists.

const MAX_BITS = 15;
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

class BitReader {
  private pos = 0;
  private buffer = 0;
  private count = 0;

  constructor(private readonly data: Uint8Array) {}

  bits(need: number): number {
    let value = this.buffer;

    while (this.count < need) {
      if (this.pos >= this.data.length) throw new Error('unexpected end of deflate data');

      value |= this.data[this.pos++] << this.count;
      this.count += 8;
    }

    this.buffer = value >>> need;
    this.count -= need;

    return value & ((1 << need) - 1);
  }

  /** Whether every byte was read: only the padding bits of the last byte may be left. */
  done(): boolean {
    return this.pos === this.data.length;
  }

  /** The next `length` whole bytes, after dropping the bits left in the current byte. */
  bytes(length: number): Uint8Array {
    this.buffer = 0;
    this.count = 0;

    if (this.pos + length > this.data.length) throw new Error('unexpected end of deflate data');

    const slice = this.data.subarray(this.pos, this.pos + length);
    this.pos += length;

    return slice;
  }
}

class Output {
  private buffer = new Uint8Array(1024);
  length = 0;

  constructor(private readonly budget: number) {}

  private reserve(extra: number): void {
    if (this.length + extra > this.budget) throw new Error('inflated data exceeds the byte budget');

    if (this.length + extra <= this.buffer.length) return;

    const grown = new Uint8Array(Math.max(this.buffer.length * 2, this.length + extra));
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  push(byte: number): void {
    this.reserve(1);
    this.buffer[this.length++] = byte;
  }

  append(bytes: Uint8Array): void {
    this.reserve(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  copy(distance: number, length: number): void {
    if (distance > this.length) throw new Error('deflate distance reaches before the output');

    this.reserve(length);

    for (let i = 0; i < length; i++, this.length++) this.buffer[this.length] = this.buffer[this.length - distance];
  }

  result(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

// Codes left unassigned by `counts` (puff.c's `construct`): negative when over-subscribed, 0 when complete.
function unassigned(counts: Uint16Array): number {
  let left = 1;

  for (let length = 1; length <= MAX_BITS; length++) {
    left = (left << 1) - counts[length];

    if (left < 0) return left;
  }

  return left;
}

// Like zlib, refuses an over-subscribed table and an incomplete one, except a lone 1-bit code where
// `allowSingle` (literal/length and distance tables); an all-zero table only fails once a code is read.
function checkTable(counts: Uint16Array, symbols: number, allowSingle: boolean): void {
  if (counts[0] === symbols) return;

  const left = unassigned(counts);

  if (left < 0) throw new Error('invalid deflate Huffman table (over-subscribed)');

  const single = allowSingle && counts[1] === 1 && counts[0] === symbols - 1;

  if (left > 0 && !single) throw new Error('invalid deflate Huffman table (incomplete)');
}

function buildHuffman(lengths: Uint8Array, allowSingle = true): Huffman {
  const counts = new Uint16Array(MAX_BITS + 1);
  const symbols = new Uint16Array(lengths.length);
  const offsets = new Uint16Array(MAX_BITS + 2);

  for (const length of lengths) counts[length]++;

  checkTable(counts, lengths.length, allowSingle);

  for (let length = 1; length <= MAX_BITS; length++) offsets[length + 1] = offsets[length] + counts[length];

  for (let symbol = 0; symbol < lengths.length; symbol++) {
    if (lengths[symbol] !== 0) symbols[offsets[lengths[symbol]]++] = symbol;
  }

  return { counts, symbols };
}

function decodeSymbol(reader: BitReader, table: Huffman): number {
  let code = 0;
  let first = 0;
  let index = 0;

  for (let length = 1; length <= MAX_BITS; length++) {
    code |= reader.bits(1);
    const count = table.counts[length];

    if (code - count < first) return table.symbols[index + (code - first)];

    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }

  throw new Error('invalid deflate Huffman code');
}

function fixedTables(): [Huffman, Huffman] {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);

  // 32 five-bit distance codes keep the table complete; 30 and 31 are refused when read.
  return [buildHuffman(lengths), buildHuffman(new Uint8Array(32).fill(5))];
}

// Expands one code-length symbol (0–15 literal, 16 repeat, 17/18 zero runs) into `lengths` at `at`.
function readCodeLength(reader: BitReader, symbol: number, lengths: Uint8Array, at: number): number {
  if (symbol < 16) {
    lengths[at] = symbol;

    return at + 1;
  }

  if (symbol === 16 && at === 0) throw new Error('deflate length repeat with no previous length');

  const [value, count] =
    symbol === 16
      ? [lengths[at - 1], 3 + reader.bits(2)]
      : [0, symbol === 17 ? 3 + reader.bits(3) : 11 + reader.bits(7)];

  if (at + count > lengths.length) throw new Error('too many deflate code lengths');

  lengths.fill(value, at, at + count);

  return at + count;
}

function dynamicTables(reader: BitReader): [Huffman, Huffman] {
  const literals = reader.bits(5) + 257;
  const distances = reader.bits(5) + 1;
  const codeLengthCount = reader.bits(4) + 4;
  const codeLengths = new Uint8Array(19);

  for (let i = 0; i < codeLengthCount; i++) codeLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);

  const codeLengthTable = buildHuffman(codeLengths, false);
  const lengths = new Uint8Array(literals + distances);
  let at = 0;

  while (at < lengths.length) at = readCodeLength(reader, decodeSymbol(reader, codeLengthTable), lengths, at);

  return [buildHuffman(lengths.subarray(0, literals)), buildHuffman(lengths.subarray(literals))];
}

function inflateCodes(reader: BitReader, out: Output, [literal, distance]: [Huffman, Huffman]): void {
  for (;;) {
    const symbol = decodeSymbol(reader, literal);

    if (symbol === 256) return;

    if (symbol < 256) {
      out.push(symbol);
      continue;
    }

    const lengthIndex = symbol - 257;

    if (lengthIndex >= LENGTH_BASE.length) throw new Error('invalid deflate length symbol');

    const length = LENGTH_BASE[lengthIndex] + reader.bits(LENGTH_EXTRA[lengthIndex]);
    const distIndex = decodeSymbol(reader, distance);

    if (distIndex >= DIST_BASE.length) throw new Error('invalid deflate distance symbol');

    out.copy(DIST_BASE[distIndex] + reader.bits(DIST_EXTRA[distIndex]), length);
  }
}

function inflateStored(reader: BitReader, out: Output): void {
  const header = reader.bytes(4);
  const length = header[0] | (header[1] << 8);
  const complement = header[2] | (header[3] << 8);

  if ((length ^ 0xffff) !== complement) throw new Error('corrupt deflate stored block');

  out.append(reader.bytes(length));
}

/** Inflates a raw DEFLATE stream; throws on corrupt data or once the output would pass `budget` bytes. */
export function inflateRawJs(data: Uint8Array, budget: number): Uint8Array {
  const reader = new BitReader(data);
  const out = new Output(budget);
  let last = 0;

  while (last === 0) {
    last = reader.bits(1);
    const type = reader.bits(2);

    if (type === 0) inflateStored(reader, out);

    if (type === 1) inflateCodes(reader, out, fixedTables());

    if (type === 2) inflateCodes(reader, out, dynamicTables(reader));

    if (type === 3) throw new Error('invalid deflate block type');
  }

  if (!reader.done()) throw new Error('unexpected bytes after the final block of deflate data');

  return out.result();
}
