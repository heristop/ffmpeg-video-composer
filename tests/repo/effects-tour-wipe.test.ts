import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAMED_CURVES } from '../../packages/ffmpeg-video-composer/src/core/motion/curves';

// The effects tour's before/after wipe crosses the whole 1280 px frame. Too fast a crossing reads as a stutter,
// worst once the web preview is decimated, so its peak speed is held under 50 px per frame at 30 fps.
const chapter = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../examples/motion-design/effects-tour/05-compositing.json'), 'utf8')
) as {
  global: { fps: number };
  sections: {
    name: string;
    options: { duration: number };
    layout?: { wipe?: { at: number; duration: number; ease: string } };
  }[];
};

const section = chapter.sections.find((candidate) => candidate.name === 'before-after');
const wipe = section?.layout?.wipe;

describe('effects tour before/after wipe', () => {
  it('crosses the frame at no more than 50 px per frame', () => {
    const curve = NAMED_CURVES[wipe?.ease ?? ''];
    const frames = Math.round((wipe?.duration ?? 0) * chapter.global.fps);
    const steps = Array.from(
      { length: frames },
      (_, frame) => 1280 * (curve((frame + 1) / frames) - curve(frame / frames))
    );

    expect(curve).toBeTypeOf('function');
    expect(Math.max(...steps)).toBeLessThanOrEqual(50);
  });

  it('holds the after image for at least a second once the wipe ends', () => {
    expect((section?.options.duration ?? 0) - (wipe?.at ?? 0) - (wipe?.duration ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
