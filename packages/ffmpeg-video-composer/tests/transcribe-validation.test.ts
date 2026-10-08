import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { BaseTemplateValidator } from '@/services/BaseTemplateValidator';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

function template(subtitles: unknown, meta?: unknown): TemplateDescriptor {
  return {
    ...(meta === undefined ? {} : { meta }),
    global: { orientation: 'portrait', musicEnabled: false },
    sections: [
      { name: 'talk', type: 'video', options: { videoUrl: 'talk.mp4', duration: 4 }, subtitles },
      { name: 'card', type: 'color_background', options: { backgroundColor: '#000000', duration: 2 } },
    ],
  } as unknown as TemplateDescriptor;
}

function errors(descriptor: TemplateDescriptor, validator: BaseTemplateValidator = new TemplateValidator()) {
  return validator.validateTemplate(descriptor).errors ?? [];
}

function codes(descriptor: TemplateDescriptor, validator?: BaseTemplateValidator): string[] {
  return errors(descriptor, validator).map((error) => error.code);
}

describe('subtitles.transcribe', () => {
  it('accepts a transcription request on its own', () => {
    expect(codes(template({ transcribe: { from: 'self', language: 'en' }, style: 'loud' }))).toEqual([]);
    expect(codes(template({ transcribe: { language: 'fr-FR' } }))).toEqual([]);
    expect(codes(template({ transcribe: { language: 'zh-Hant-TW' } }))).toEqual([]);
    expect(codes(template({ transcribe: {} }))).toEqual([]);
  });

  it('rejects a language that is not a BCP-47 tag (it reaches the transcriber command line)', () => {
    for (const language of ['en:destination=/tmp/pwn', 'en,amovie=x', "e'n", 'english', 'e n']) {
      expect(codes(template({ transcribe: { language } })).length).toBeGreaterThan(0);
    }
  });

  it('rejects a request next to pinned words, cues or srt', () => {
    const words = [{ text: 'Hi', start: 0, end: 0.4 }];
    const found = errors(template({ transcribe: { from: 'self' }, words }));

    expect(found).toEqual([
      expect.objectContaining({ path: 'sections.0.subtitles', message: expect.stringContaining('transcribe') }),
    ]);
  });

  it('rejects a source that is not a clip section', () => {
    const found = errors(template({ transcribe: { from: 'card' } }));

    expect(found).toEqual([
      expect.objectContaining({ code: 'invalid_transcribe_source', path: 'sections[0].subtitles.transcribe.from' }),
    ]);
    expect(codes(template({ transcribe: { from: 'nope' } }))).toEqual(['invalid_transcribe_source']);
  });

  it('rejects "self" on a section without a clip', () => {
    const descriptor = {
      sections: [
        {
          name: 'card',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 2 },
          subtitles: { transcribe: { from: 'self' } },
        },
      ],
    } as unknown as TemplateDescriptor;

    expect(codes(descriptor)).toEqual(['invalid_transcribe_source']);
  });

  it('reports transcribe_unavailable on engines that cannot transcribe', () => {
    const browser = new BaseTemplateValidator({ transcription: false });
    const found = errors(template({ transcribe: { from: 'self' } }), browser);

    expect(found).toEqual([
      expect.objectContaining({
        code: 'transcribe_unavailable',
        path: 'sections[0].subtitles.transcribe',
        hint: expect.stringContaining('leclap transcribe'),
      }),
    ]);
  });

  it('accepts word confidences and a pinned transcript record', () => {
    const words = [{ text: 'Hi', start: 0, end: 0.4, confidence: 0.92 }];
    const meta = {
      resolved: {
        transcripts: {
          talk: {
            from: 'self',
            engine: 'whisper.cpp',
            model: 'base',
            language: 'en',
            digest: 'sha256:abc',
            at: '2026-10-07T10:00:00.000Z',
            confidence: 0.92,
          },
        },
      },
    };

    expect(codes(template({ words }, meta))).toEqual([]);
  });
});

describe('transcript advisories', () => {
  function warnings(subtitles: unknown) {
    return new TemplateValidator()
      .getMotionWarnings(template(subtitles))
      .filter((warning) => warning.code.startsWith('transcript'));
  }

  it('flags a pinned transcript the recogniser was unsure of', () => {
    const words = ['so', 'we', 'shipped', 'it'].map((text, index) => ({
      text,
      start: index * 0.5,
      end: index * 0.5 + 0.4,
      confidence: 0.3,
    }));

    expect(warnings({ words })).toEqual([
      expect.objectContaining({ code: 'transcript_low_confidence', path: 'sections[0].subtitles.words' }),
    ]);
  });

  it('stays quiet for confident or unscored words', () => {
    const words = [
      { text: 'Hello', start: 0, end: 0.4, confidence: 0.95 },
      { text: 'there', start: 0.5, end: 0.9, confidence: 0.9 },
    ];

    expect(warnings({ words })).toEqual([]);
    expect(warnings({ words: [{ text: 'Hi', start: 0, end: 0.4 }] })).toEqual([]);
  });
});
