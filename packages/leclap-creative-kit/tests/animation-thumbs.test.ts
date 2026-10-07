// The picker thumbnails (scripts/gen-animation-thumbs.ts) cover every library entry, stay plain blobs and
// stay inside their byte budgets.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_LIBRARY, sampleEntries } from '../src/editor/animation-library';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/library/animation-thumbs');
const animations = path.resolve(dir, '../animations');

interface ThumbEntry {
  id: string;
  label: string;
  thumb: string;
  poster: string;
  kind: 'fx' | 'graphic' | 'sample';
}

const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as ThumbEntry[];
const bytes = (file: string) => statSync(path.join(dir, file)).size;

describe('animation library thumbnails', () => {
  it('has a looping thumb and a poster for every engine entry, of its kind', () => {
    for (const entry of ENGINE_LIBRARY) {
      const thumb = manifest.find((row) => row.id === entry.id && row.kind !== 'sample');

      expect(thumb, entry.id).toBeDefined();
      expect(thumb?.kind).toBe(entry.kind);
      expect(thumb?.thumb).toMatch(/\.webp$/);
      expect(thumb?.poster).toMatch(/\.png$/);
    }
  });

  it('has a poster for every sample the picker lists', () => {
    const files = readdirSync(animations).filter((file) => /\.(apng|webp|gif|webm)$/.test(file));

    for (const sample of sampleEntries(files)) {
      expect(
        manifest.find((row) => row.kind === 'sample' && row.id === sample.id),
        sample.id
      ).toBeDefined();
    }
  });

  it('ships real images (no LFS pointers) within the 60 KB per thumb and 1 MB total budgets', () => {
    const files = [...new Set(manifest.flatMap((row) => [row.thumb, row.poster]))];

    for (const file of files) {
      const head = readFileSync(path.join(dir, file)).subarray(0, 4).toString('latin1');

      expect(['RIFF', '\u0089PNG'], file).toContain(head);
    }
    for (const row of manifest.filter((entry) => entry.kind !== 'sample')) {
      expect(bytes(row.thumb), row.thumb).toBeLessThanOrEqual(60 * 1024);
    }
    expect(files.reduce((sum, file) => sum + bytes(file), 0)).toBeLessThanOrEqual(1024 * 1024);
  });
});
