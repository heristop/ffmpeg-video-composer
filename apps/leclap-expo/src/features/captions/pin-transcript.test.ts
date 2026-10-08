import { pinTranscript, transcribeRequests, unpinnedTranscriptions } from './pin-transcript';

const record = { from: 'intro', engine: 'ios-speech', language: 'en-US', at: '2026-10-07T10:00:00.000Z' };
const words = [
  { text: 'Hello', start: 0, end: 0.4, confidence: 0.9 },
  { text: 'there.', start: 0.5, end: 0.9, confidence: 0.7 },
];

const descriptor = () => ({
  meta: { name: 'Talk' },
  sections: [
    { name: 'intro', type: 'project_video' },
    { name: 'outro', type: 'project_video', subtitles: { transcribe: { from: 'self' }, style: 'loud' } },
  ],
});

describe('pinTranscript', () => {
  it('adds default captions to a section that had none and records the pin', () => {
    const pinned = pinTranscript(descriptor(), 'intro', words, record);

    expect(pinned.sections[0]).toEqual({
      name: 'intro',
      type: 'project_video',
      subtitles: { words, style: 'clean', karaoke: 'word' },
    });
    expect(pinned.meta).toEqual({
      name: 'Talk',
      resolved: { transcripts: { intro: { ...record, confidence: 0.8 } } },
    });
  });

  it('replaces a transcribe request and keeps the authored look', () => {
    const pinned = pinTranscript(descriptor(), 'outro', words, record);

    expect(pinned.sections[1].subtitles).toEqual({ words, style: 'loud' });
  });

  it('degrades karaoke to phrase highlighting when the timings are coarse', () => {
    const pinned = pinTranscript(descriptor(), 'intro', words, record, { coarse: true });

    expect(pinned.sections[0].subtitles).toEqual({ words, style: 'clean', karaoke: false });
  });

  it('never mutates the input and ignores an unknown section', () => {
    const input = descriptor();
    const pinned = pinTranscript(input, 'missing', words, record);

    expect(pinned).toEqual(input);
    expect(input.sections[0]).not.toHaveProperty('subtitles');
  });
});

describe('unpinnedTranscriptions', () => {
  it('lists the sections still asking for a transcription', () => {
    expect(unpinnedTranscriptions(descriptor())).toEqual(['outro']);
    expect(unpinnedTranscriptions(pinTranscript(descriptor(), 'outro', words, record))).toEqual([]);
    expect(unpinnedTranscriptions({})).toEqual([]);
  });

  it('names the step whose clip a request listens to, once', () => {
    const listening = {
      sections: [
        { name: 'talk', type: 'project_video', subtitles: { transcribe: {} } },
        { name: 'card', type: 'color_background', subtitles: { transcribe: { from: 'talk' } } },
      ],
    };

    expect(unpinnedTranscriptions(listening)).toEqual(['talk']);
  });
});

describe('transcribeRequests', () => {
  it('lists each request with the step it listens to and its language', () => {
    const listening = {
      sections: [
        { name: 'talk', type: 'project_video', subtitles: { transcribe: { language: 'de' } } },
        { name: 'card', type: 'color_background', subtitles: { transcribe: { from: 'talk' } } },
        { name: 'self', type: 'project_video', subtitles: { transcribe: { from: 'self' } } },
        { name: 'plain', type: 'project_video' },
      ],
    };

    expect(transcribeRequests(listening)).toEqual([
      { section: 'talk', source: 'talk', language: 'de' },
      { section: 'card', source: 'talk' },
      { section: 'self', source: 'self' },
    ]);
  });
});
