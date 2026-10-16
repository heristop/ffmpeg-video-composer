import { describe, expect, it } from 'vitest';
import { referenceFrameArgs } from '../src/commands/compare';

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
});
