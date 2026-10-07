// Raw DEFLATE for template links: the platform's CompressionStream / DecompressionStream (Node ≥ 18, every
// current browser) when present, else a stored-block writer and the small JS inflater (Hermes). Both
// paths produce and read the same `deflate-raw` format, so a link made on one runtime opens on any other.
import { inflateRawJs } from './inflate-js';

const STORED_BLOCK_MAX = 0xffff;

function hasStreams(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** `bytes` as uncompressed (stored) DEFLATE blocks: valid deflate-raw that any inflater reads. */
export function deflateStored(bytes: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(bytes.length / STORED_BLOCK_MAX));
  const out = new Uint8Array(bytes.length + blocks * 5);
  let at = 0;

  for (let block = 0; block < blocks; block++) {
    const chunk = bytes.subarray(block * STORED_BLOCK_MAX, (block + 1) * STORED_BLOCK_MAX);
    out.set([block === blocks - 1 ? 1 : 0, chunk.length & 255, chunk.length >> 8], at);
    out.set([~chunk.length & 255, (~chunk.length >> 8) & 255], at + 3);
    out.set(chunk, at + 5);
    at += chunk.length + 5;
  }

  return out;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;

  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
}

// Reads the stream to its end, one chunk after the other, cancelling it once the output passes `budget`.
async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  budget: number,
  chunks: Uint8Array[] = [],
  total = 0
): Promise<Uint8Array> {
  const { done, value } = await reader.read();

  if (done) return concat(chunks, total);

  if (total + value.length > budget) {
    await reader.cancel();

    throw new Error('inflated data exceeds the byte budget');
  }

  chunks.push(value);

  return drain(reader, budget, chunks, total + value.length);
}

// Feeds `bytes` through a (de)compression transform and drains its output. The write is not awaited:
// it resolves only as the output is read, and a corrupt input rejects through the readable side.
function transform(stream: CompressionStream | DecompressionStream, bytes: Uint8Array, budget: number) {
  const writer = stream.writable.getWriter();
  writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});

  return drain(stream.readable.getReader(), budget);
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (!hasStreams()) return deflateStored(bytes);

  return transform(new CompressionStream('deflate-raw'), bytes, Number.POSITIVE_INFINITY);
}

/** Inflates raw DEFLATE; rejects on corrupt data or once the output would pass `budget` bytes. */
export async function inflateRaw(bytes: Uint8Array, budget: number): Promise<Uint8Array> {
  if (!hasStreams()) return inflateRawJs(bytes, budget);

  return transform(new DecompressionStream('deflate-raw'), bytes, budget);
}
