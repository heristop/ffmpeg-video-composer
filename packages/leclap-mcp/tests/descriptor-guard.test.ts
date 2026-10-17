import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TemplateDescriptor } from 'ffmpeg-video-composer';

import { assertDescriptorSafe } from '../src/compose/descriptorGuard.js';

let mediaDir: string;
let outsideDir: string;

beforeEach(async () => {
  mediaDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-media-')));
  outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-outside-')));
});

afterEach(async () => {
  await fs.rm(mediaDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

// A descriptor with a single drawtext filter using the given fontfile, for the fontfile-containment
// cases. Cast through unknown because these fixtures intentionally exercise the raw filter surface.
function drawtextDescriptor(fontfile: string): TemplateDescriptor {
  return {
    sections: [
      {
        name: 'title',
        type: 'color_background',
        options: { backgroundColor: '#000', duration: 2 },
        filters: [{ type: 'drawtext', values: { text: { en: 'hi' }, fontfile } }],
      },
    ],
  } as unknown as TemplateDescriptor;
}

describe('assertDescriptorSafe', () => {
  it('allows a clean descriptor with a bundled font name', async () => {
    const result = await assertDescriptorSafe(drawtextDescriptor('BebasNeue.ttf'), mediaDir);

    expect(result.ok).toBe(true);
  });

  it('rejects a movie source filter (arbitrary file read / SSRF)', async () => {
    const descriptor = {
      sections: [{ name: 's', type: 'video', filters: [{ type: 'movie', value: '/etc/passwd' }] }],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/movie/i);
  });

  it('rejects an amovie source filter regardless of casing/whitespace', async () => {
    const descriptor = {
      sections: [{ name: 's', type: 'video', filters: [{ type: '  AMovie ', value: 'http://169.254.169.254/' }] }],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result.ok).toBe(false);
  });

  it('rejects the subtitles and ass file-reading filters', async () => {
    for (const type of ['subtitles', 'ass']) {
      const descriptor = {
        sections: [{ name: 's', type: 'video', filters: [{ type, value: '/etc/passwd' }] }],
      } as unknown as TemplateDescriptor;

      const result = await assertDescriptorSafe(descriptor, mediaDir);

      expect(result.ok).toBe(false);
    }
  });

  it('rejects a file smuggled through a benign filter value (curves=psfile=…)', async () => {
    const descriptor = {
      sections: [{ name: 's', type: 'video', filters: [{ type: 'curves', value: 'psfile=/etc/passwd' }] }],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/file|path/i);
  });

  it('rejects a URL smuggled through a scalar value (SSRF)', async () => {
    const descriptor = {
      sections: [
        { name: 's', type: 'video', filters: [{ type: 'anullsrc', value: 'http://169.254.169.254/latest/' }] },
      ],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result.ok).toBe(false);
  });

  it('rejects a quoted file option smuggled through a scalar value', async () => {
    const descriptor = {
      sections: [{ name: 's', type: 'video', filters: [{ type: 'curves', value: "'psfile'=/etc/passwd" }] }],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result.ok).toBe(false);
  });

  it('rejects a quote-free file option smuggled through a structured values field', async () => {
    const descriptor = {
      sections: [
        {
          name: 's',
          type: 'video',
          filters: [{ type: 'overlay', values: { alpha: '1:textfile=/etc/hosts' } }],
        },
      ],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result.ok).toBe(false);
  });

  it('rejects a metadata filter writing to an absolute path (file option)', async () => {
    const descriptor = {
      sections: [{ name: 's', type: 'video', filters: [{ type: 'metadata', value: 'mode=print:file=/tmp/x' }] }],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result.ok).toBe(false);
  });

  it('still allows a caption that contains a URL-like string', async () => {
    const result = await assertDescriptorSafe(drawtextDescriptor('BebasNeue.ttf'), mediaDir);

    expect(result.ok).toBe(true);
  });

  it('allows a legitimate curves control-point value (no false positive on slashes)', async () => {
    const descriptor = {
      sections: [{ name: 's', type: 'video', filters: [{ type: 'curves', value: 'all=0/0 0.5/0.4 1/1' }] }],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result.ok).toBe(true);
  });

  it('allows a plain scale value with a colon (no false positive)', async () => {
    const descriptor = {
      sections: [{ name: 's', type: 'video', filters: [{ type: 'scale', value: '1280:720' }] }],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result.ok).toBe(true);
  });

  it('rejects a source filter nested inside a map filter chain (recursive walk)', async () => {
    const descriptor = {
      sections: [
        {
          name: 's',
          type: 'video',
          maps: [{ inputs: ['0:v'], outputs: ['out'], filters: [{ type: 'movie', value: '/etc/hosts' }] }],
        },
      ],
    } as unknown as TemplateDescriptor;

    const result = await assertDescriptorSafe(descriptor, mediaDir);

    expect(result.ok).toBe(false);
  });

  it('rejects an absolute fontfile outside the media dir', async () => {
    const outside = path.join(outsideDir, 'evil.ttf');
    await fs.writeFile(outside, 'x');

    const result = await assertDescriptorSafe(drawtextDescriptor(outside), mediaDir);

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/media/i);
  });

  it('rejects a traversal fontfile that climbs out of the media dir', async () => {
    const outside = path.join(outsideDir, 'evil.ttf');
    await fs.writeFile(outside, 'x');
    const traversal = path.join(mediaDir, '..', path.basename(outsideDir), 'evil.ttf');

    const result = await assertDescriptorSafe(drawtextDescriptor(traversal), mediaDir);

    expect(result.ok).toBe(false);
  });

  // Aligned with the engine: a drawtext fontfile is a bare font name it stages (bundled, catalog, cache);
  // a font file of the media dir is declared in global.fonts instead.
  it('rejects a fontfile path even inside the media dir', async () => {
    const inside = path.join(mediaDir, 'brand.ttf');
    await fs.writeFile(inside, 'x');

    const result = await assertDescriptorSafe(drawtextDescriptor(inside), mediaDir);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/global\.fonts/);
  });
});

// Filtergraph syntax smuggled through a string field the filter scan above never reads (a transition
// colour lands in a `color=c=…` source): every string leaf is scanned for source/file filter syntax.
function dripDescriptor(color: string, title = 'Hello'): TemplateDescriptor {
  return {
    global: { transition: { type: 'drip', duration: 1, color: '#123456' } },
    sections: [
      {
        name: 'a',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2 },
        transition: { type: 'drip', duration: 1, color },
        filters: [{ type: 'drawtext', values: { text: { en: title } } }],
      },
      { name: 'b', type: 'color_background', options: { backgroundColor: '#ffffff', duration: 2 } },
    ],
  } as unknown as TemplateDescriptor;
}

describe('assertDescriptorSafe: filtergraph syntax in any string field', () => {
  it.each([
    'red:s=2x2[x];[x]nullsink;movie=/etc/passwd',
    'red;amovie@a=/etc/passwd',
    'red, movie = /etc/passwd',
    'red;[x]drawtext=textfile=/etc/passwd',
    'red,curves=psfile=/tmp/x.acv',
    // FFmpeg's tokenizer drops backslashes, so an escaped name still runs.
    String.raw`red,nullsink;mo\vie=/etc/passwd`,
    String.raw`red;a\movie=/etc/passwd`,
    'red;sendcmd=f=/tmp/cmds.txt',
    'red,zmq',
    String.raw`red;[x]azmq=bind_address=tcp\://0.0.0.0\:5555`,
    'red,arnndn=m=/tmp/model.rnnn',
    'red;[x]drawtext=file=/etc/passwd',
    'red;sendcmd@a=f=/tmp/cmds.txt',
  ])('rejects a drip colour carrying %s', async (color) => {
    const result = await assertDescriptorSafe(dripDescriptor(color), mediaDir);

    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.message).toMatch(/transition\.color/);
  });

  it('rejects the same syntax in the global transition', async () => {
    const descriptor = dripDescriptor('#F96F99') as unknown as { global: { transition: { color: string } } };
    descriptor.global.transition.color = 'red;movie=/etc/passwd';

    const result = await assertDescriptorSafe(descriptor as unknown as TemplateDescriptor, mediaDir);

    expect(result.ok).toBe(false);
  });

  it.each([
    'Hello; world',
    'Movies; the best of 2026',
    'Watch the movie, then the sequel',
    'Profile: file = notes.txt',
    'See https://leclap.dev; it renders',
    'Send cmd; zmq fans welcome',
    'f = ma, the law',
    String.raw`C:\Users\me, a path in a caption`,
    'Fill the form, file = done',
  ])('keeps ordinary copy such as %s', async (title) => {
    const result = await assertDescriptorSafe(dripDescriptor('$color.accent', title), mediaDir);

    expect(result.ok).toBe(true);
  });
});

// The raw filter surface: a filter's `type` and scalar `value` reach FFmpeg as `type=value`.
function rawFilterDescriptor(filter: Record<string, unknown>): TemplateDescriptor {
  return {
    sections: [
      {
        name: 's',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2 },
        filters: [filter],
      },
    ],
  } as unknown as TemplateDescriptor;
}

describe('assertDescriptorSafe: raw filter type and value', () => {
  it.each([
    { type: 'drawtext', value: 'textfile=/etc/passwd:x=0' },
    { type: 'drawtext=textfile=/etc/passwd:x', values: { x: '0' } },
    { type: 'movie', value: '/etc/passwd' },
    { type: 'subtitles', value: 'subs.srt' },
    { type: 'sofalizer', value: 'sofa=/tmp/a.sofa' },
    { type: 'whisper', value: 'model=/tmp/m.bin' },
    { type: 'dnn_processing', value: 'model=/tmp/m.pb' },
    { type: 'haldclut' },
    { type: 'ocr', value: 'datapath=/tmp' },
    { type: 'drawbox', values: { x: '0', dumpfile: '/tmp/x' } },
    { type: 'removelogo', value: 'm=/tmp/mask.png' },
  ])('refuses %o', async (filter) => {
    const result = await assertDescriptorSafe(rawFilterDescriptor(filter), mediaDir);

    expect(result.ok, JSON.stringify(filter)).toBe(false);
  });

  it.each([
    { type: 'pad', value: '1120:558:(ow-iw)/2:(oh-ih)/2:color=0x10141e' },
    { type: 'perspective', value: "x0='W*0.025':sense=destination:eval=frame" },
    { type: 'lut3d', value: 'teal-orange' },
  ])('keeps %o', async (filter) => {
    const result = await assertDescriptorSafe(rawFilterDescriptor(filter), mediaDir);

    expect(result.ok, JSON.stringify(filter)).toBe(true);
  });
});

describe('assertDescriptorSafe: a protocol behind an escaped colon', () => {
  it.each([
    { type: 'metadata', value: String.raw`print:a:b:same_str:1:'file\:/tmp/pwned'` },
    { type: 'metadata', value: String.raw`print:a:b:same_str:1:'http\://127.0.0.1/x'` },
    { type: 'metadata', value: String.raw`print:a:b:same_str:1:'gopherx\:a'` },
    { type: 'drawbox', values: { x: String.raw`'subfile\:/etc/passwd'` } },
  ])('refuses %o', async (filter) => {
    const result = await assertDescriptorSafe(rawFilterDescriptor(filter), mediaDir);

    expect(result.ok, JSON.stringify(filter)).toBe(false);
  });

  it.each([
    { type: 'drawtext', value: String.raw`text='Note\: 10\:30':x=10` },
    { type: 'drawtext', values: { text: { en: 'Doors open: 10:30' }, x: String.raw`'00\:00\:01'` } },
    { type: 'fade', value: 'in:0:30' },
  ])('keeps %o', async (filter) => {
    const result = await assertDescriptorSafe(rawFilterDescriptor(filter), mediaDir);

    expect(result.ok, JSON.stringify(filter)).toBe(true);
  });
});
