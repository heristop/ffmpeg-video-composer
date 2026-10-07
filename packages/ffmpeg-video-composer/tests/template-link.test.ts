import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  builderLinkUrl,
  createBuilderLink,
  decodeTemplatePayload,
  encodeTemplatePayload,
  readTemplateLinkPayload,
  TEMPLATE_LINK_LIMITS,
  TemplateLinkError,
} from '@/core/template-link';
import { fromBase64Url, toBase64Url } from '@/core/template-link/base64url';
import { deflateRaw, deflateStored, inflateRaw } from '@/core/template-link/deflate';
import { inflateRawJs } from '@/core/template-link/inflate-js';

// Built from parts: the lint rule against script URLs is right everywhere but in a test of refusing them.
const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');

const TEMPLATES_DIR = join(import.meta.dirname, '../../leclap-creative-kit/src/templates');

const minimal = {
  meta: { name: 'Café ☕ — 日本語 🎬' },
  global: { orientation: 'landscape' },
  sections: [{ name: 'intro', type: 'color_background', options: { duration: 2, backgroundColor: '#101820' } }],
};

async function linkError(run: () => Promise<unknown>): Promise<TemplateLinkError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof TemplateLinkError) return error;
    throw error;
  }

  throw new Error('expected a TemplateLinkError');
}

// Bytes that compress badly, so the deflate output stays large: a seeded xorshift stream.
function noise(length: number, seed = 1): string {
  let state = 0x9e3779b9 ^ seed;
  let out = '';

  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out += String.fromCodePoint(33 + (Math.abs(state) % 90));
  }

  return out;
}

describe('base64url', () => {
  it('round-trips every byte value without padding or URL-unsafe characters', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);

    for (const size of [0, 1, 2, 3, 4, 255, 256]) {
      const slice = bytes.slice(0, size);
      const text = toBase64Url(slice);

      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(text)).toEqual(slice);
    }
  });

  it('refuses characters outside the alphabet and impossible lengths', () => {
    expect(() => fromBase64Url('ab+c')).toThrow();
    expect(() => fromBase64Url('abcde')).toThrow();
  });
});

// Packs `fields` ([value, bit count] pairs, LSB first as DEFLATE reads them) into bytes, zero-padded.
function packBits(fields: Array<[number, number]>): Uint8Array {
  const bits = fields.flatMap(([value, count]) => Array.from({ length: count }, (_, i) => (value >> i) & 1));
  const bytes = new Uint8Array(Math.ceil(bits.length / 8) + 64);

  for (const [i, bit] of bits.entries()) bytes[i >> 3] |= bit << (i & 7);

  return bytes;
}

// A final dynamic block header (BFINAL=1, BTYPE=2, HLIT=257, HDIST=1) and the code-length code lengths.
function dynamicHeader(codeLengthLengths: number[]): Array<[number, number]> {
  return [
    [1, 1],
    [2, 2],
    [0, 5],
    [0, 5],
    [codeLengthLengths.length - 4, 4],
    ...codeLengthLengths.map((l) => [l, 3] as [number, number]),
  ];
}

describe('deflate-raw', () => {
  const text = new TextEncoder().encode(JSON.stringify(minimal).repeat(40));

  it('round-trips through the platform streams', async () => {
    const packed = await deflateRaw(text);

    expect(packed.length).toBeLessThan(text.length);
    expect(await inflateRaw(packed, 1 << 20)).toEqual(text);
  });

  it('inflates a platform stream with the pure-JS fallback', async () => {
    const packed = await deflateRaw(text);

    expect(inflateRawJs(packed, 1 << 20)).toEqual(text);
  });

  it('writes stored blocks the platform streams and the fallback both read', async () => {
    const big = new TextEncoder().encode(noise(70_000));
    const stored = deflateStored(big);

    expect(await inflateRaw(stored, 1 << 20)).toEqual(big);
    expect(inflateRawJs(stored, 1 << 20)).toEqual(big);
  });

  it('stops inflating past the byte budget', async () => {
    const packed = await deflateRaw(new Uint8Array(100_000));

    await expect(inflateRaw(packed, 1000)).rejects.toThrow(/budget/);
    expect(() => inflateRawJs(packed, 1000)).toThrow(/budget/);
  });

  it('rejects bytes after the final block on both paths, and only padding bits pass', async () => {
    const packed = await deflateRaw(text);
    const junk = new Uint8Array([...packed, ...new TextEncoder().encode('JUNK')]);
    const storedJunk = new Uint8Array([...deflateStored(text), 0]);

    await expect(inflateRaw(junk, 1 << 20)).rejects.toThrow();
    expect(() => inflateRawJs(junk, 1 << 20)).toThrow(/after the final block/);
    await expect(inflateRaw(storedJunk, 1 << 20)).rejects.toThrow();
    expect(() => inflateRawJs(storedJunk, 1 << 20)).toThrow(/after the final block/);
  });

  it('rejects an over-subscribed Huffman table on both paths', async () => {
    // 19 code-length codes of length 1: more codes than one bit can tell apart.
    const oversubscribed = packBits(dynamicHeader(Array.from({ length: 19 }, () => 1)));

    await expect(inflateRaw(oversubscribed, 1 << 20)).rejects.toThrow();
    expect(() => inflateRawJs(oversubscribed, 1 << 20)).toThrow(/over-subscribed/);
  });

  it('rejects an incomplete Huffman table on both paths', async () => {
    // One code-length code of length 2 leaves three of the four 2-bit codes unassigned.
    const incomplete = packBits(dynamicHeader([0, 0, 0, 2]));

    await expect(inflateRaw(incomplete, 1 << 20)).rejects.toThrow();
    expect(() => inflateRawJs(incomplete, 1 << 20)).toThrow(/incomplete/);
  });

  it('rejects garbage', async () => {
    const garbage = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x00]);

    await expect(inflateRaw(garbage, 1000)).rejects.toThrow();
    expect(() => inflateRawJs(garbage, 1000)).toThrow();
  });
});

describe('template payload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips unicode text under a versioned prefix', async () => {
    const payload = await encodeTemplatePayload(minimal);

    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(await decodeTemplatePayload(payload)).toEqual(minimal);
  });

  it('round-trips every bundled creative-kit template', async () => {
    for (const file of readdirSync(TEMPLATES_DIR).filter((name) => name.endsWith('.json'))) {
      const template: unknown = JSON.parse(readFileSync(join(TEMPLATES_DIR, file), 'utf8'));
      const payload = await encodeTemplatePayload(template);

      expect(await decodeTemplatePayload(payload)).toEqual(template);
      expect(payload.length).toBeLessThan(TEMPLATE_LINK_LIMITS.warnLength);
    }
  });

  it('round-trips a large template', async () => {
    const sections = Array.from({ length: 400 }, (_, i) => ({
      name: `scene_${String(i)}`,
      type: 'color_background',
      options: { duration: 1 + (i % 5), backgroundColor: '#112233' },
      description: { en: `Scene ${String(i)} — ünïcödé ${noise(40)}` },
    }));
    const large = { ...minimal, sections };
    const payload = await encodeTemplatePayload(large);

    expect(await decodeTemplatePayload(payload)).toEqual(large);
  });

  it('works without CompressionStream (Hermes) and stays readable where it exists', async () => {
    const nativePayload = await encodeTemplatePayload(minimal);

    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);

    const fallbackPayload = await encodeTemplatePayload(minimal);

    expect(await decodeTemplatePayload(nativePayload)).toEqual(minimal);
    expect(await decodeTemplatePayload(fallbackPayload)).toEqual(minimal);

    vi.unstubAllGlobals();

    expect(await decodeTemplatePayload(fallbackPayload)).toEqual(minimal);
  });

  it('names what is wrong with a bad payload', async () => {
    expect((await linkError(() => decodeTemplatePayload(''))).code).toBe('empty');
    expect((await linkError(() => decodeTemplatePayload('v9.abc'))).code).toBe('unsupported_version');
    expect((await linkError(() => decodeTemplatePayload('v1.@@@'))).code).toBe('malformed');
    expect((await linkError(() => decodeTemplatePayload('v1.AAAAAAAA'))).code).toBe('corrupt');
  });

  it('refuses a payload over the hard limit before decoding it', async () => {
    const huge = `v1.${'A'.repeat(TEMPLATE_LINK_LIMITS.maxPayloadLength + 1)}`;

    expect((await linkError(() => decodeTemplatePayload(huge))).code).toBe('too_large');
  });

  it('refuses JSON that is not a template, listing the issues', async () => {
    const notJson = `v1.${toBase64Url(await deflateRaw(new TextEncoder().encode('{nope')))}`;
    const invalid = await encodeTemplatePayload({ sections: [{ name: 'x', type: 'nope' }] });

    expect((await linkError(() => decodeTemplatePayload(notJson))).code).toBe('invalid_json');

    const error = await linkError(() => decodeTemplatePayload(invalid));

    expect(error.code).toBe('invalid_template');
    expect(error.issues.length).toBeGreaterThan(0);
  });
});

describe('builder link', () => {
  it('points at the builder route with the payload in the fragment', () => {
    expect(builderLinkUrl('v1.abc')).toBe('https://leclap.dev/studio/builder#t=v1.abc');
    expect(builderLinkUrl('v1.abc', 'http://localhost:5173/')).toBe('http://localhost:5173/studio/builder#t=v1.abc');
    expect(builderLinkUrl('v1.abc', 'https://leclap.dev/fr')).toBe('https://leclap.dev/fr/studio/builder#t=v1.abc');
  });

  it('refuses a base that is not an http(s) URL', () => {
    expect(() => builderLinkUrl('v1.abc', 'ftp://example.com')).toThrow(TemplateLinkError);
    expect(() => builderLinkUrl('v1.abc', 'not a url')).toThrow(TemplateLinkError);
  });

  it('reads the payload back from a location hash', () => {
    expect(readTemplateLinkPayload('#t=v1.abc')).toBe('v1.abc');
    expect(readTemplateLinkPayload('#other=1&t=v1.abc')).toBe('v1.abc');
    expect(readTemplateLinkPayload('#projects')).toBeNull();
    expect(readTemplateLinkPayload('')).toBeNull();
  });

  it('creates a link with its length, media to re-bind and warnings', async () => {
    const template = {
      ...minimal,
      sections: [
        ...minimal.sections,
        { name: 'clip', type: 'video', options: { videoUrl: '/Users/me/clips/take-1.mp4' } },
      ],
    };
    const link = await createBuilderLink(template, { baseUrl: 'http://localhost:5173' });

    expect(link.url.startsWith('http://localhost:5173/studio/builder#t=v1.')).toBe(true);
    expect(link.length).toBe(link.url.length);
    expect(link.mediaToRebind).toEqual([
      { pointer: '/sections/1/options/videoUrl', value: '/Users/me/clips/take-1.mp4', reason: 'local_path' },
    ]);
    expect(link.warnings.join(' ')).toMatch(/take-1\.mp4/);
    expect(await decodeTemplatePayload(readTemplateLinkPayload(new URL(link.url).hash) ?? '')).toEqual(template);
  });

  it('refuses an invalid template and one too large for a link', async () => {
    expect((await linkError(() => createBuilderLink({ sections: 'nope' }))).code).toBe('invalid_template');

    const sections = Array.from({ length: 60 }, (_, i) => ({
      name: `s${String(i)}`,
      type: 'color_background',
      options: { duration: 1, backgroundColor: '#000000' },
      description: { en: noise(10_000, i + 1) },
    }));

    expect((await linkError(() => createBuilderLink({ ...minimal, sections }))).code).toBe('too_large');
  });

  it('warns when the link is long enough for chat apps to truncate', async () => {
    const sections = Array.from({ length: 2 }, (_, i) => ({
      name: `s${String(i)}`,
      type: 'color_background',
      options: { duration: 1, backgroundColor: '#000000' },
      description: { en: noise(6000, i + 1) },
    }));
    const link = await createBuilderLink({ ...minimal, sections });

    expect(link.length).toBeGreaterThan(TEMPLATE_LINK_LIMITS.warnLength);
    expect(link.warnings.join(' ')).toMatch(/truncate/);
  });

  it('warns when the link opens anywhere but leclap.dev, whose page reads the fragment', async () => {
    const official = await createBuilderLink(minimal);
    const french = await createBuilderLink(minimal, { baseUrl: 'https://leclap.dev/fr' });
    const local = await createBuilderLink(minimal, { baseUrl: 'http://localhost:5173' });
    const elsewhere = await createBuilderLink(minimal, { baseUrl: 'https://builder.example.com' });

    expect(official.warnings).toEqual([]);
    expect(french.warnings).toEqual([]);
    expect(local.warnings.join(' ')).toMatch(/http:\/\/localhost:5173.*fragment/);
    expect(elsewhere.warnings.join(' ')).toMatch(/https:\/\/builder\.example\.com.*fragment/);
  });

  it('warns that media under an unsupported scheme is dropped', async () => {
    const template = {
      ...minimal,
      sections: [...minimal.sections, { name: 'clip', type: 'video', options: { videoUrl: SCRIPT_URL } }],
    };
    const link = await createBuilderLink(template);

    expect(link.mediaToRebind).toEqual([
      { pointer: '/sections/1/options/videoUrl', value: SCRIPT_URL, reason: 'unsupported_scheme' },
    ]);
    expect(link.warnings.join(' ')).toMatch(/scheme.*javascript:alert\(1\)/);
  });

  it('warns that effect sections do not open in the builder', async () => {
    const template = {
      ...minimal,
      sections: [
        ...minimal.sections,
        {
          name: 'title',
          type: 'effect',
          effect: { id: 'leclap.title-reveal', version: '1.0.0', props: {}, assets: {} },
          options: { duration: 3 },
        },
      ],
    };
    const link = await createBuilderLink(template);

    expect(link.warnings.join(' ')).toMatch(/effect/i);
  });
});
