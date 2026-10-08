import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPins, transcribe } from '../src/commands/transcribe';

const transcribeMediaFileMock = vi.fn();
const transcribeTemplateMock = vi.fn();
const files = new Map<string, string>();

vi.mock('ffmpeg-video-composer', () => ({
  transcribeMediaFile: (...args: unknown[]) => transcribeMediaFileMock(...args),
  transcribeTemplate: (...args: unknown[]) => transcribeTemplateMock(...args),
  transcriptSrt: (words: Array<{ text: string }>) =>
    `1\n00:00:00,000 --> 00:00:01,000\n${words.map((w) => w.text).join(' ')}\n`,
}));

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(async (file: string) => {
      if (file.includes('missing')) throw new Error(`ENOENT: no such file, stat ${file}`);

      return { isFile: () => true };
    }),
    readFile: vi.fn(async (file: string) => files.get(file) ?? ''),
    writeFile: vi.fn(async (file: string, data: string) => {
      files.set(file, data);
    }),
  },
}));

const TRANSCRIPT = {
  engine: 'whisper.cpp',
  model: 'base',
  language: 'en',
  words: [
    { text: 'Hello', start: 0.5, end: 0.9, confidence: 0.9 },
    { text: 'world.', start: 1, end: 1.4, confidence: 0.8 },
  ],
};

const PIN = {
  section: 'talk',
  words: 2,
  record: { from: 'talk', engine: 'whisper.cpp', model: 'base', language: 'en', digest: 'sha256:a', confidence: 0.85 },
};

const plain = (s: string): string => stripVTControlCharacters(s);

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  files.clear();
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));

    return true;
  });
  vi.spyOn(console, 'log').mockImplementation((line) => stdout.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line) => stderr.push(String(line)));
  transcribeMediaFileMock.mockReset();
  transcribeTemplateMock.mockReset();
  process.exitCode = undefined;
  delete process.env.LECLAP_WHISPER_DOWNLOAD;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  delete process.env.LECLAP_WHISPER_DOWNLOAD;
});

async function run(args: Record<string, unknown>): Promise<void> {
  await (transcribe.run as (ctx: { args: Record<string, unknown>; rawArgs: string[] }) => Promise<void>)({
    args,
    rawArgs: (args.rawArgs as string[] | undefined) ?? [],
  });
}

describe('leclap transcribe <media>', () => {
  it('prints the words, language and SRT as JSON', async () => {
    transcribeMediaFileMock.mockResolvedValue(TRANSCRIPT);

    await run({ input: 'talk.m4a', json: true, language: 'en', model: 'tiny', downloadModel: true });

    const out = JSON.parse(stdout.join(''));

    expect(out).toMatchObject({ language: 'en', engine: 'whisper.cpp', words: TRANSCRIPT.words, confidence: 0.85 });
    expect(out.srt).toContain('Hello world.');
    expect(transcribeMediaFileMock).toHaveBeenCalledWith('talk.m4a', { language: 'en', model: 'tiny', download: true });
  });

  it('prints plain SRT', async () => {
    transcribeMediaFileMock.mockResolvedValue(TRANSCRIPT);

    await run({ input: 'talk.m4a', srt: true });

    expect(stdout.join('')).toBe('1\n00:00:00,000 --> 00:00:01,000\nHello world.\n');
  });

  it('rejects an unknown model and a missing file', async () => {
    await run({ input: 'talk.m4a', model: 'huge' });
    expect(process.exitCode).toBe(1);
    expect(plain(stderr.join('\n'))).toContain('--model');

    process.exitCode = undefined;
    await run({ input: 'missing.m4a' });
    expect(process.exitCode).toBe(1);
    expect(transcribeMediaFileMock).not.toHaveBeenCalled();
  });

  it('surfaces the transcriber install hint', async () => {
    transcribeMediaFileMock.mockRejectedValue(new Error('transcriber_unavailable: no whisper.cpp found'));

    await run({ input: 'talk.m4a' });

    expect(process.exitCode).toBe(1);
    expect(plain(stderr.join('\n'))).toContain('transcriber_unavailable');
  });
});

describe('leclap transcribe <template>', () => {
  const template = { sections: [{ name: 'talk', type: 'video', subtitles: { transcribe: {} } }] };
  const pinned = { sections: [{ name: 'talk', type: 'video', subtitles: { words: TRANSCRIPT.words } }] };

  it('pins the template in place, with the clip bindings and section filter', async () => {
    files.set('/work/promo.json', JSON.stringify(template));
    transcribeTemplateMock.mockResolvedValue({ descriptor: pinned, pins: [PIN], stale: [] });

    await run({
      input: '/work/promo.json',
      section: 'talk',
      assets: '/work/assets',
      downloadModel: true,
      rawArgs: ['/work/promo.json', '--video', 'talk=/clips/talk.mov'],
    });

    expect(transcribeTemplateMock).toHaveBeenCalledWith(template, {
      assetsDir: '/work/assets',
      userVideoPaths: { talk: '/clips/talk.mov' },
      sections: ['talk'],
      force: false,
      // The CLI stamps the pin's time; the engine's render path never reads the clock.
      now: expect.any(Function),
    });
    expect(process.env.LECLAP_WHISPER_DOWNLOAD).toBe('1');
    expect(JSON.parse(files.get('/work/promo.json') as string)).toEqual(pinned);
    expect(plain(stdout.join('\n'))).toContain('talk: pinned 2 words');
  });

  it('writes to --out, or prints with --json', async () => {
    files.set('/work/promo.json', JSON.stringify(template));
    transcribeTemplateMock.mockResolvedValue({ descriptor: pinned, pins: [PIN], stale: [] });

    await run({ input: '/work/promo.json', out: '/work/pinned.json' });
    expect(JSON.parse(files.get('/work/pinned.json') as string)).toEqual(pinned);

    stdout.length = 0;
    await run({ input: '/work/promo.json', json: true });
    expect(JSON.parse(stdout.join(''))).toEqual(pinned);
  });

  it('reports stale pins and leaves the file alone when nothing was pinned', async () => {
    files.set('/work/promo.json', JSON.stringify(pinned));
    transcribeTemplateMock.mockResolvedValue({
      descriptor: pinned,
      pins: [],
      stale: [{ code: 'transcript_stale', message: 'Section "talk": stale', hint: 'Re-transcribe with --force' }],
    });

    await run({ input: '/work/promo.json' });

    const text = plain(stdout.join('\n'));

    expect(text).toContain('transcript_stale');
    expect(text).toContain('nothing to transcribe');
  });
});

describe('formatPins', () => {
  it('names the engine, language and confidence of each pin', () => {
    expect(plain(formatPins([PIN]).join('\n'))).toContain(
      'talk: pinned 2 words (whisper.cpp base, en, confidence 0.85)'
    );
  });
});
