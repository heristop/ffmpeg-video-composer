import { mapTranscriptWords, spreadSegments, meanConfidence } from './transcript-mapping';

const words = [
  { text: 'Hello', start: 0.5, end: 0.9, confidence: 0.9 },
  { text: 'world,', start: 1.0, end: 1.4, confidence: 0.8 },
  { text: 'again.', start: 3.0, end: 3.5, confidence: 0.7 },
];

describe('mapTranscriptWords', () => {
  it('keeps source times when the section has no time edits', () => {
    expect(mapTranscriptWords(words, undefined)).toEqual(words);
  });

  it('shifts by clip.from and drops words outside the clip range', () => {
    expect(mapTranscriptWords(words, { clip: { from: 0.6, to: 2 } })).toEqual([
      { text: 'Hello', start: 0, end: 0.3, confidence: 0.9 },
      { text: 'world,', start: 0.4, end: 0.8, confidence: 0.8 },
    ]);
  });

  it('scales by options.speed, a PTS multiplier (2 = slow motion)', () => {
    expect(mapTranscriptWords(words.slice(0, 1), { speed: 2 })).toEqual([
      { text: 'Hello', start: 1, end: 1.8, confidence: 0.9 },
    ]);
  });

  it('caps the words at the declared section length, as the engine does', () => {
    expect(mapTranscriptWords(words, { duration: 1.2 })).toEqual([
      { text: 'Hello', start: 0.5, end: 0.9, confidence: 0.9 },
      { text: 'world,', start: 1, end: 1.2, confidence: 0.8 },
    ]);
  });

  it('untangles overlapping recogniser words and drops blank ones', () => {
    const jittered = [
      { text: 'one', start: 0, end: 0.6 },
      { text: ' ', start: 0.3, end: 0.4 },
      { text: 'two', start: 0.5, end: 0.9 },
    ];

    expect(mapTranscriptWords(jittered, undefined)).toEqual([
      { text: 'one', start: 0, end: 0.6 },
      { text: 'two', start: 0.6, end: 0.9 },
    ]);
  });

  it('applies a freeze hold through the engine mapper', () => {
    const held = mapTranscriptWords(words.slice(2), { freeze: [{ at: 2, hold: 0.5 }] }, { fps: 30 });

    expect(held).toEqual([{ text: 'again.', start: 3.5, end: 4, confidence: 0.7 }]);
  });

  it('scales a preset speed ramp to the recorded clip length', () => {
    const ramped = mapTranscriptWords(words.slice(2), { speedRamp: 'hero' }, { sourceLength: 4 });
    const unscaled = mapTranscriptWords(words.slice(2), { speedRamp: 'hero' });

    expect(ramped).not.toEqual(unscaled);
  });

  it('drops words whose midpoint falls outside the range and clamps straddling ends', () => {
    expect(mapTranscriptWords(words, { clip: { from: 1.3 } }).map((word) => word.text)).toEqual(['again.']);
    expect(mapTranscriptWords(words, { clip: { to: 3.3 } }).at(-1)).toEqual({
      text: 'again.',
      start: 3,
      end: 3.3,
      confidence: 0.7,
    });
  });
});

describe('spreadSegments', () => {
  it('shares a phrase window between its words by character count', () => {
    expect(spreadSegments([{ text: 'hi there', start: 0, end: 0.7 }])).toEqual([
      { text: 'hi', start: 0, end: 0.2 },
      { text: 'there', start: 0.2, end: 0.7 },
    ]);
  });

  it('skips empty segments', () => {
    expect(spreadSegments([{ text: '  ', start: 0, end: 1 }])).toEqual([]);
  });
});

describe('meanConfidence', () => {
  it('averages the words that carry a confidence', () => {
    expect(meanConfidence(words)).toBe(0.8);
    expect(meanConfidence([{ text: 'a', start: 0, end: 1 }])).toBeUndefined();
  });
});
