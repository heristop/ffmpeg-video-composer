import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beats, formatBeats, templateBeats } from '../src/commands/beats';

const analyzeMusicFileMock = vi.fn();

vi.mock('ffmpeg-video-composer', () => ({
  analyzeMusicFile: (...args: unknown[]) => analyzeMusicFileMock(...args),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(async (file: string) => {
      if (file === 'missing.mp3') throw new Error('ENOENT: no such file, stat missing.mp3');

      return { isFile: () => true };
    }),
  },
}));

const ANALYSIS = {
  bpm: 128,
  offset: 0.37,
  beatsPerBar: 4,
  times: [0.37, 0.839],
  confidence: 4.93,
  usable: true,
  cues: { build: 8.1, drop: 15.37, end: 29.9 },
};

const plain = (s: string): string => stripVTControlCharacters(s);

describe('formatBeats', () => {
  it('reports the grid and the global.beats block to paste', () => {
    const text = formatBeats('song.mp3', ANALYSIS).map(plain).join('\n');

    expect(text).toContain('128 BPM, beat 1 at 0.370s');
    expect(text).toContain('drop 15.370s');
    expect(text).toContain(JSON.stringify(templateBeats(ANALYSIS)));
  });

  it('tells the author to pace a calm track by phrases', () => {
    const text = formatBeats('pad.mp3', { ...ANALYSIS, usable: false, confidence: 1.2, cues: { end: 60 } })
      .map(plain)
      .join('\n');

    expect(text).toContain('no reliable pulse');
    expect(text).toContain('Pace this track by phrases');
    expect(text).toContain('drop none');
  });
});

describe('leclap beats', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout.push(String(chunk));

      return true;
    });
    vi.spyOn(console, 'log').mockImplementation((line) => stdout.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line) => stderr.push(String(line)));
    analyzeMusicFileMock.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  async function run(args: Record<string, unknown>): Promise<void> {
    await (beats.run as (ctx: { args: Record<string, unknown> }) => Promise<void>)({ args });
  }

  it('emits the whole analysis as JSON', async () => {
    analyzeMusicFileMock.mockResolvedValue(ANALYSIS);

    await run({ audio: 'song.mp3', json: true });

    expect(JSON.parse(stdout.join(''))).toEqual(ANALYSIS);
    expect(analyzeMusicFileMock).toHaveBeenCalledWith('song.mp3', { beatsPerBar: undefined });
  });

  it('passes the bar length through', async () => {
    analyzeMusicFileMock.mockResolvedValue({ ...ANALYSIS, beatsPerBar: 3 });

    await run({ audio: 'waltz.mp3', json: true, beatsPerBar: '3' });

    expect(analyzeMusicFileMock).toHaveBeenCalledWith('waltz.mp3', { beatsPerBar: 3 });
  });

  it('fails cleanly on a missing file or a bad bar length', async () => {
    await run({ audio: 'missing.mp3', json: false });
    expect(process.exitCode).toBe(1);
    expect(plain(stderr.join('\n'))).toContain('ENOENT');

    process.exitCode = undefined;
    await run({ audio: 'song.mp3', json: false, beatsPerBar: '0' });
    expect(process.exitCode).toBe(1);
    expect(analyzeMusicFileMock).not.toHaveBeenCalled();
  });
});
