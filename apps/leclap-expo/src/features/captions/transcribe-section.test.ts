import {
  transcribeSection,
  speechLocale,
  captionLanguage,
  TranscriptionError,
  type NativeTranscript,
  type SpeechEngine,
} from './transcribe-section';

const words = [
  { text: 'Bonjour', start: 1, end: 1.5, confidence: 0.9 },
  { text: 'à', start: 1.6, end: 1.7, confidence: 0.5 },
  { text: 'tous.', start: 1.8, end: 2.2, confidence: 0.7 },
];

type FakeEngine = SpeechEngine & { calls: Array<[string, { language: string }]> };

function engine(overrides: Partial<SpeechEngine> = {}, transcript?: NativeTranscript): FakeEngine {
  const calls: FakeEngine['calls'] = [];

  return {
    calls,
    isAvailable: async () => ({ available: true, onDevice: true }),
    requestPermission: async () => true,
    transcribeFile: async (uri, options) => {
      calls.push([uri, options]);

      return transcript ?? { language: 'fr-FR', words, segmentsOnly: false, digest: 'sha256:abc' };
    },
    ...overrides,
  };
}

const base = {
  source: 'talk',
  clipPath: 'file:///clip.mov',
  language: 'fr-FR',
  platform: 'ios' as const,
  now: () => new Date('2026-10-07T10:00:00.000Z'),
};

describe('transcribeSection', () => {
  it('transcribes the clip on device and returns pinned, time-mapped captions', async () => {
    const speech = engine();
    const captions = await transcribeSection({ ...base, speech, options: { clip: { from: 1 } } });

    expect(speech.calls).toEqual([['file:///clip.mov', { language: 'fr-FR' }]]);
    expect(captions).toEqual({
      words: [
        { text: 'Bonjour', start: 0, end: 0.5, confidence: 0.9 },
        { text: 'à', start: 0.6, end: 0.7, confidence: 0.5 },
        { text: 'tous.', start: 0.8, end: 1.2, confidence: 0.7 },
      ],
      coarse: false,
      clipPath: 'file:///clip.mov',
      record: {
        from: 'talk',
        engine: 'ios-speech',
        language: 'fr-FR',
        digest: 'sha256:abc',
        at: '2026-10-07T10:00:00.000Z',
      },
    });
  });

  it('spreads phrase-only results and flags them coarse', async () => {
    const speech = engine(
      {},
      { language: 'en-US', words: [], segments: [{ text: 'hi there', start: 0, end: 0.7 }], segmentsOnly: true }
    );
    const captions = await transcribeSection({ ...base, platform: 'android', speech });

    expect(captions.coarse).toBe(true);
    expect(captions.record.engine).toBe('android-speech');
    expect(captions.words.map((word) => word.text)).toEqual(['hi', 'there']);
  });

  it('refuses when on-device recognition is unavailable, never falling back to a server', async () => {
    const speech = engine({
      isAvailable: async () => ({ available: false, onDevice: false, reason: 'needs Android 13+' }),
    });

    await expect(transcribeSection({ ...base, speech })).rejects.toEqual(
      new TranscriptionError('unavailable', 'needs Android 13+')
    );
    expect(speech.calls).toEqual([]);
  });

  it('stops when the speech permission is denied', async () => {
    const speech = engine({ requestPermission: async () => false });

    await expect(transcribeSection({ ...base, speech })).rejects.toMatchObject({ code: 'permission' });
  });

  it('reports a clip without recognisable speech', async () => {
    const speech = engine({}, { language: 'fr-FR', words: [], segmentsOnly: false });

    await expect(transcribeSection({ ...base, speech })).rejects.toMatchObject({ code: 'empty' });
  });
});

describe('captionLanguage', () => {
  it('prefers the language the template asks for over the device locale', () => {
    expect(captionLanguage('de', 'fr-FR')).toBe('de-DE');
    expect(captionLanguage('pt-BR', 'fr-FR')).toBe('pt-BR');
    expect(captionLanguage(undefined, 'fr')).toBe('fr-FR');
    expect(captionLanguage(undefined, undefined)).toBe('en-US');
  });
});

describe('speechLocale', () => {
  it('turns a bare app language into a recogniser locale and keeps full tags', () => {
    expect(speechLocale('fr')).toBe('fr-FR');
    expect(speechLocale('en')).toBe('en-US');
    expect(speechLocale('pt-BR')).toBe('pt-BR');
    expect(speechLocale(undefined)).toBe('en-US');
  });
});
