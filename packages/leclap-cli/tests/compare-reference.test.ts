import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertReadableReference, referenceFrameArgs, referenceTilePath } from '../src/commands/compare';

describe('compare --reference', () => {
  it('grabs one frame of the reference at the compared moment, scaled to the tile width', () => {
    expect(referenceFrameArgs('ref.mp4', 2.5, 'out/reference.png', 640)).toEqual([
      '-v',
      'error',
      '-y',
      '-ss',
      '2.5',
      '-i',
      'ref.mp4',
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      'out/reference.png',
    ]);
  });

  it('names the reference tile like the other compare tiles, so a user file is left alone', () => {
    expect(referenceTilePath('out')).toBe(path.join('out', 'compare-reference.png'));
  });

  describe('a reference that is not a video', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'leclap-compare-ref-'));
    const bogus = path.join(dir, 'notes.mp4');

    writeFileSync(bogus, 'not a video at all\n');
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('fails before any render with a short reason', async () => {
      const failure = await assertReadableReference(bogus).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/^Reference could not be read: \S/);
      expect((failure as Error).message).not.toContain('\n');
      expect((failure as Error).message).not.toContain(dir);
    });
  });
});
