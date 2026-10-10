import { describe, expect, it } from 'vitest';
import { encodePreview, previewTwoPassArgs, previewVideoArgs } from '../../examples/showcase/preview-export';

const filterOf = (args: string[]): string => args[args.indexOf('-vf') + 1] ?? '';

describe('showcase preview export', () => {
  it('keeps the 24 fps, CRF 26 preview by default', () => {
    const args = previewVideoArgs('in.mp4', 'out.mp4');

    expect(filterOf(args)).toMatch(/,fps=24$/);
    expect(args).toEqual(expect.arrayContaining(['-crf', '26']));
    expect(args).not.toContain('-af');
  });

  it('keeps the source frame rate when asked, so fast motion is not decimated', () => {
    expect(filterOf(previewVideoArgs('in.mp4', 'out.mp4', { fps: 'source' }))).not.toContain('fps=');
  });

  it('applies an audio gain', () => {
    const args = previewVideoArgs('in.mp4', 'out.mp4', { gainDb: -3.5 });

    expect(args[args.indexOf('-af') + 1]).toBe('volume=-3.5dB');
  });

  it('encodes to a bitrate in two passes, the first without audio or output', () => {
    const [first, second] = previewTwoPassArgs('in.mp4', 'out.mp4', {
      videoBitrateK: 380,
      passlog: '/tmp/tour',
      fps: 'source',
      gainDb: -3.5,
    });

    expect(first).toEqual(expect.arrayContaining(['-pass', '1', '-passlogfile', '/tmp/tour', '-b:v', '380k', '-an']));
    expect(first.slice(-3)).toEqual(['-f', 'null', '-']);
    expect(second).toEqual(expect.arrayContaining(['-pass', '2', '-passlogfile', '/tmp/tour', '-b:v', '380k']));
    expect(second).toEqual(expect.arrayContaining(['-af', 'volume=-3.5dB', '-movflags', '+faststart']));
    expect(second.at(-1)).toBe('out.mp4');
    expect(second).not.toContain('-crf');
    expect(filterOf(second)).not.toContain('fps=');
  });
});

describe('showcase preview encode policy', () => {
  it('encodes the effects tour at its own frame rate, in two passes, to a budget under 25 MiB', () => {
    const runs: string[][] = [];
    encodePreview('effects-tour', 'tour.mp4', 'out.mp4', {
      ffmpeg: (args) => runs.push(args),
      probe: () => ({ format: { duration: '420' } }),
      work: '/tmp/work',
    });
    const bitrate = Number(runs[1]?.[runs[1].indexOf('-b:v') + 1]?.replace('k', ''));

    expect(runs).toHaveLength(2);
    expect(filterOf(runs[1] ?? [])).not.toContain('fps=');
    expect(runs[1]).toEqual(expect.arrayContaining(['-af', 'volume=-3.5dB']));
    expect(((bitrate + 128) * 1000 * 420) / 8 / 1024 / 1024).toBeLessThan(25);
  });

  it('keeps every other sample on the single 24 fps pass', () => {
    const runs: string[][] = [];
    encodePreview('kinetic-type', 'in.mp4', 'out.mp4', {
      ffmpeg: (args) => runs.push(args),
      probe: () => ({ format: { duration: 10 } }),
      work: '/tmp/work',
    });

    expect(runs).toEqual([previewVideoArgs('in.mp4', 'out.mp4')]);
  });
});
