import { describe, expect, it, vi } from 'vitest';
import { editFingerprint, pinTranscript, staleTranscripts } from '@/core/captions/transcript-pin';
import { resolveTranscripts, type TranscriptionDeps } from '@/director/transcription';
import type { Transcript } from '@/core/captions/transcript';

const RECORD = {
  from: 'talk',
  engine: 'whisper.cpp',
  model: 'base',
  language: 'en',
  digest: 'sha256:aaa',
  at: '2026-10-07T10:00:00.000Z',
};

function descriptor(subtitles: Record<string, unknown> = { transcribe: { from: 'self' }, style: 'loud' }) {
  return {
    meta: { name: 'Talk' },
    sections: [
      { name: 'intro', type: 'color_background', options: { duration: 1 } },
      { name: 'talk', type: 'video', options: { videoUrl: 'talk.mp4', clip: { from: 1 } }, subtitles },
    ],
  };
}

describe('pinTranscript', () => {
  it('replaces the request with the words and records how they were made', () => {
    const words = [{ text: 'Hi', start: 0, end: 0.3, confidence: 0.8 }];
    const pinned = pinTranscript(descriptor(), 1, words, RECORD);

    expect(pinned.sections[1].subtitles).toEqual({ style: 'loud', words });
    expect(pinned.meta).toEqual({ name: 'Talk', resolved: { transcripts: { talk: RECORD } } });
  });

  it('leaves the input untouched', () => {
    const input = descriptor();

    pinTranscript(input, 1, [], RECORD);

    expect(input.sections[1].subtitles).toEqual({ transcribe: { from: 'self' }, style: 'loud' });
    expect(input.meta).toEqual({ name: 'Talk' });
  });
});

describe('editFingerprint', () => {
  it('fingerprints the edits between the clip and the timeline, in any key order', () => {
    const a = editFingerprint({ clip: { from: 1, to: 3 }, speed: 2, videoUrl: 'a.mp4' });

    expect(a).toMatch(/^fnv1a:[0-9a-f]{8}$/);
    expect(editFingerprint({ speed: 2, clip: { to: 3, from: 1 }, videoUrl: 'b.mp4' })).toBe(a);
    expect(editFingerprint({ clip: { from: 1, to: 3 }, speed: 1 })).not.toBe(a);
  });

  it('covers every option the transcript edit reads', () => {
    const base = editFingerprint({});
    const edits = [
      { speed: 2 },
      { clip: { from: 1 } },
      { trimSilence: true },
      { keep: [[0, 1]] },
      { speedRamp: 'hero' },
      { freeze: [{ at: 1, hold: 1 }] },
      { duration: 3 },
    ];

    for (const edit of edits) expect(editFingerprint(edit)).not.toBe(base);
  });
});

describe('staleTranscripts', () => {
  it('reports a pin whose section edits changed since', () => {
    const record = { ...RECORD, edit: editFingerprint(descriptor().sections[1].options) };
    const pinned = pinTranscript(descriptor(), 1, [{ text: 'Hi', start: 0, end: 0.3 }], record);
    const retrimmed = {
      ...pinned,
      sections: [pinned.sections[0], { ...pinned.sections[1], options: { videoUrl: 'talk.mp4', clip: { from: 2 } } }],
    };

    expect(staleTranscripts(pinned, {})).toEqual([]);
    expect(staleTranscripts(retrimmed, {})).toEqual([
      expect.objectContaining({
        code: 'transcript_edit_changed',
        path: 'meta.resolved.transcripts.talk',
        severity: 'warn',
      }),
    ]);
  });

  it('cannot tell for older pins without an edit fingerprint', () => {
    const pinned = pinTranscript(descriptor(), 1, [], RECORD);
    const retrimmed = { ...pinned, sections: [pinned.sections[0], { ...pinned.sections[1], options: { speed: 2 } }] };

    expect(staleTranscripts(retrimmed, {})).toEqual([]);
  });

  it('reports a pin whose clip changed', () => {
    const pinned = pinTranscript(descriptor(), 1, [{ text: 'Hi', start: 0, end: 0.3 }], RECORD);

    expect(staleTranscripts(pinned, { talk: 'sha256:aaa' })).toEqual([]);
    expect(staleTranscripts(pinned, { talk: 'sha256:bbb' })).toEqual([
      expect.objectContaining({ code: 'transcript_stale', path: 'meta.resolved.transcripts.talk', severity: 'warn' }),
    ]);
    expect(staleTranscripts(pinned, {})).toEqual([]);
  });
});

function deps(transcript: Partial<Transcript> = {}): TranscriptionDeps & { transcribe: ReturnType<typeof vi.fn> } {
  return {
    transcribe: vi.fn(async () => ({
      engine: 'whisper.cpp',
      model: 'base',
      language: 'en',
      words: [
        { text: 'skipped', start: 0.2, end: 0.6, confidence: 0.9 },
        { text: 'Hello', start: 1.5, end: 1.9, confidence: 0.8 },
      ],
      ...transcript,
    })),
    sourceOf: vi.fn(async (name: string) => `/clips/${name}.mp4`),
    editOf: (section) => ({ from: (section.options as { clip?: { from?: number } }).clip?.from }),
    digestOf: vi.fn(async () => 'sha256:ccc'),
    now: () => '2026-10-07T12:00:00.000Z',
  };
}

describe('resolveTranscripts', () => {
  it('transcribes the source clip, maps it to section time and pins it', async () => {
    const host = deps();
    const { descriptor: pinned, pins } = await resolveTranscripts(descriptor(), host);

    expect(host.transcribe).toHaveBeenCalledWith('/clips/talk.mp4', { from: 'self' });
    expect(pinned.sections[1].subtitles).toEqual({
      style: 'loud',
      words: [{ text: 'Hello', start: 0.5, end: 0.9, confidence: 0.8 }],
    });
    expect(pins).toEqual([
      {
        section: 'talk',
        record: {
          from: 'talk',
          engine: 'whisper.cpp',
          model: 'base',
          language: 'en',
          digest: 'sha256:ccc',
          at: '2026-10-07T12:00:00.000Z',
          confidence: 0.8,
          edit: editFingerprint({ videoUrl: 'talk.mp4', clip: { from: 1 } }),
        },
        words: 1,
      },
    ]);
  });

  it('never reads the clock itself: without an injected `now` the pin has no time and repeats exactly', async () => {
    const { now: _now, ...host } = deps();
    const first = await resolveTranscripts(descriptor(), host);
    const second = await resolveTranscripts(descriptor(), host);

    expect(first.pins[0]?.record).not.toHaveProperty('at');
    expect(JSON.stringify(first.descriptor)).toBe(JSON.stringify(second.descriptor));
  });

  it('passes the requested language and model through', async () => {
    const host = deps();

    await resolveTranscripts(descriptor({ transcribe: { language: 'fr', model: 'tiny' } }), host);

    expect(host.transcribe).toHaveBeenCalledWith('/clips/talk.mp4', { language: 'fr', model: 'tiny' });
  });

  it('degrades coarse (phrase-timed) transcripts to plain captions', async () => {
    const { descriptor: pinned } = await resolveTranscripts(
      descriptor({ transcribe: {}, karaoke: 'word' }),
      deps({ coarse: true })
    );

    expect(pinned.sections[1].subtitles).toMatchObject({ karaoke: false });
  });

  it('fails clearly when the clip cannot be found', async () => {
    const host = deps();
    host.sourceOf = async () => null;

    await expect(resolveTranscripts(descriptor(), host)).rejects.toThrow(/talk.*no clip/);
  });

  it('is a no-op without requests', async () => {
    const host = deps();
    const input = descriptor({ words: [] });

    expect((await resolveTranscripts(input, host)).descriptor).toBe(input);
    expect(host.transcribe).not.toHaveBeenCalled();
  });
});
