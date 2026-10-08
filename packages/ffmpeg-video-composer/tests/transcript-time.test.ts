import { describe, expect, it } from 'vitest';
import { mapTranscriptWords, transcriptEditFor } from '@/core/captions/transcript-time';

const words = (...spans: Array<[string, number, number]>) =>
  spans.map(([text, start, end]) => ({ text, start, end, confidence: 0.9 }));

describe('mapTranscriptWords', () => {
  it('keeps source times on an unedited clip, rounded to the millisecond', () => {
    expect(mapTranscriptWords(words(['Hello', 0.1234, 0.5]), {})).toEqual([
      { text: 'Hello', start: 0.123, end: 0.5, confidence: 0.9 },
    ]);
  });

  it('shifts by the clip in-point and drops words outside the range', () => {
    const mapped = mapTranscriptWords(words(['before', 0, 0.8], ['in', 1.2, 1.5], ['after', 3.1, 3.4]), {
      from: 1,
      to: 3,
    });

    expect(mapped).toEqual([{ text: 'in', start: 0.2, end: 0.5, confidence: 0.9 }]);
  });

  it('clamps a word straddling the in-point into the section', () => {
    expect(mapTranscriptWords(words(['edge', 0.9, 1.4]), { from: 1 })).toEqual([
      { text: 'edge', start: 0, end: 0.4, confidence: 0.9 },
    ]);
  });

  it('stretches by options.speed, a PTS multiplier (2 = half rate)', () => {
    expect(mapTranscriptWords(words(['slow', 1, 1.5]), { speed: 2 })).toEqual([
      { text: 'slow', start: 2, end: 3, confidence: 0.9 },
    ]);
  });

  it('maps through a speed ramp', () => {
    // 2 s at real time, then double speed: source 3 s plays at output 2.5 s.
    const edit = {
      pieces: [
        { o0: 0, s0: 0, speed: 1 },
        { o0: 2, s0: 2, speed: 2 },
      ],
    };

    expect(mapTranscriptWords(words(['fast', 3, 4]), edit)).toEqual([
      { text: 'fast', start: 2.5, end: 3, confidence: 0.9 },
    ]);
  });

  it('pushes words after a freeze frame by its hold', () => {
    const edit = { fps: 30, freezes: [{ at: 1, frame: 30, frames: 30, flash: false, audio: 'silence' as const }] };

    expect(mapTranscriptWords(words(['pre', 0.2, 0.6], ['post', 1.5, 1.8]), edit)).toEqual([
      { text: 'pre', start: 0.2, end: 0.6, confidence: 0.9 },
      { text: 'post', start: 2.5, end: 2.8, confidence: 0.9 },
    ]);
  });

  it('leaves words in place across a freeze whose sound keeps playing', () => {
    const continued = { at: 1, frame: 30, frames: 30, flash: false, audio: 'continue' as const };
    const silenced = { at: 3, frame: 90, frames: 15, flash: false, audio: 'silence' as const };

    // The continue hold (1 s) does not pause the sound; the silence hold at section 3 s (ramp 2 s) does.
    expect(
      mapTranscriptWords(words(['pre', 0.2, 0.6], ['post', 1.5, 1.8], ['late', 2.5, 2.8]), {
        fps: 30,
        freezes: [continued, silenced],
      })
    ).toEqual([
      { text: 'pre', start: 0.2, end: 0.6, confidence: 0.9 },
      { text: 'post', start: 1.5, end: 1.8, confidence: 0.9 },
      { text: 'late', start: 3, end: 3.3, confidence: 0.9 },
    ]);
  });

  it('follows kept take windows and drops the cut silences', () => {
    const edit = {
      keep: [
        [0.5, 2],
        [4, 6],
      ] as Array<[number, number]>,
    };

    expect(mapTranscriptWords(words(['one', 0.6, 1], ['cut', 3, 3.4], ['two', 4.5, 5]), edit)).toEqual([
      { text: 'one', start: 0.1, end: 0.5, confidence: 0.9 },
      { text: 'two', start: 2, end: 2.5, confidence: 0.9 },
    ]);
  });

  it('cuts at the section length', () => {
    expect(mapTranscriptWords(words(['in', 0.5, 1], ['tail', 1.9, 2.4], ['gone', 2.5, 3]), { duration: 2 })).toEqual([
      { text: 'in', start: 0.5, end: 1, confidence: 0.9 },
      { text: 'tail', start: 1.9, end: 2, confidence: 0.9 },
    ]);
  });

  it('orders overlapping recogniser output so the words never overlap', () => {
    expect(mapTranscriptWords(words(['b', 1, 1.4], ['a', 0.2, 1.1]), {})).toEqual([
      { text: 'a', start: 0.2, end: 1.1, confidence: 0.9 },
      { text: 'b', start: 1.1, end: 1.4, confidence: 0.9 },
    ]);
  });
});

describe('transcriptEditFor', () => {
  it('reads the clip range, speed and declared length of a section', () => {
    const edit = transcriptEditFor({ clip: { from: 1, to: 4 }, speed: 0.5, duration: 3 }, { fps: 30 });

    expect(edit).toMatchObject({ from: 1, to: 4, speed: 0.5, duration: 3, pieces: null });
  });

  it('plans a preset ramp on the probed length', () => {
    const edit = transcriptEditFor({ speedRamp: 'hero' }, { fps: 30, sourceLength: 6 });

    expect(edit.pieces?.length).toBeGreaterThan(1);
  });

  it('prefers kept windows when the take is edited', () => {
    const edit = transcriptEditFor({ keep: [[0, 1]] }, { fps: 30, keep: [[0.2, 1]] });

    expect(edit.keep).toEqual([[0.2, 1]]);
  });
});
