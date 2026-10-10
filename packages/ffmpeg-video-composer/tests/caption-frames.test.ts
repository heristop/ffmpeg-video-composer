import { describe, expect, it } from 'vitest';
import { planSubtitles, type SubtitlePlan } from '@/core/captions/plan';
import { ENTRANCE_LEVELS, POP_LEVELS, captionSlides, type CaptionSlide } from '@/core/captions/caption-frames';
import type { WordTiming } from '@/core/captions/grouping';
import type { Subtitles } from '@/schemas/subtitles.schemas';

const FRAME = { width: 1280, height: 720 };
const resolveText = (text: Record<string, string | undefined>): string => text.en ?? text.text ?? '';

function words(spec: string): WordTiming[] {
  return spec.split(' ').map((token) => {
    const [text, times] = token.split('@');
    const [start, end] = times.split('-').map(Number);

    return { text, start, end };
  });
}

function plan(subtitles: Partial<Subtitles>): SubtitlePlan {
  const planned = planSubtitles({ ...subtitles } as Subtitles, { frame: FRAME, resolveText });

  if (!planned) throw new Error('no plan');

  return planned;
}

// The style without its entrance, so a test reads karaoke states alone.
function still(planned: SubtitlePlan): SubtitlePlan {
  const dna = { ...planned.style.dna, entrance: { ...planned.style.dna.entrance, type: 'none' as const } };

  return { ...planned, style: { ...planned.style, dna } };
}

function ordered(slides: CaptionSlide[]): boolean {
  return slides.every((slide, i) => slide.to > slide.from && (i === 0 || slides[i - 1].to <= slide.from));
}

const TWO = words('Hello@1-1.5 world@1.6-2');

describe('captionSlides', () => {
  it('holds a plain cue as one state over its frames', () => {
    const slides = captionSlides(still(plan({ cues: [{ at: 1, end: 2, text: 'Hello' }], karaoke: false })), 30);

    expect(slides).toEqual([
      { from: 30, to: 60, state: { cue: 0, active: -1, filled: 0, bump: 0, reveal: ENTRANCE_LEVELS } },
    ]);
  });

  it('starts each state on the first frame drawtext would enable it on', () => {
    const slides = captionSlides(still(plan({ words: TWO, karaoke: 'word' })), 30);
    const actives = slides.map((slide) => [slide.from, slide.state.active]);

    // The cue appears at 0.92 s (lead 0.08), its first word is active from 1 s across the bridged 0.1 s
    // silence, the second from 1.6 s to 2 s, then the cue lingers with no word active.
    expect(actives).toEqual([
      [28, -1],
      [30, 0],
      [48, 1],
      [60, -1],
    ]);
    expect(ordered(slides)).toBe(true);
  });

  it('counts the words a fill has lit', () => {
    const slides = captionSlides(still(plan({ words: TWO, karaoke: 'fill' })), 30);

    expect(slides.map((slide) => slide.state.filled)).toEqual([0, 1, 2]);
    expect(slides.map((slide) => slide.from)).toEqual([28, 30, 48]);
    expect(slides.every((slide) => slide.state.active === -1)).toBe(true);
  });

  it('samples a pop into a few bump levels that settle back', () => {
    const slides = captionSlides(still(plan({ words: TWO, karaoke: 'pop' })), 30);
    const first = slides.filter((slide) => slide.state.active === 0).map((slide) => slide.state.bump);

    expect(Math.max(...first)).toBe(POP_LEVELS);
    expect(new Set(first).size).toBeLessThanOrEqual(POP_LEVELS + 1);
    expect(first.at(-1)).toBe(0);
  });

  it('samples the entrance into at most ENTRANCE_LEVELS states and skips the invisible frame', () => {
    const slides = captionSlides(plan({ cues: [{ at: 1, end: 2, text: 'Hello' }], karaoke: false }), 30);
    const reveals = slides.map((slide) => slide.state.reveal);

    expect(reveals.at(-1)).toBe(ENTRANCE_LEVELS);
    expect(reveals.every((level) => level > 0)).toBe(true);
    expect(new Set(reveals).size).toBeLessThanOrEqual(ENTRANCE_LEVELS);
    expect(slides[0].from).toBeGreaterThanOrEqual(30);
  });

  it('is the same for the same plan', () => {
    const planned = plan({ words: TWO, karaoke: 'pop', style: 'loud' });

    expect(captionSlides(planned, 30)).toEqual(captionSlides(planned, 30));
  });

  it('draws the crown without karaoke', () => {
    const slides = captionSlides(still(plan({ words: TWO, karaoke: 'word', crown: 'auto' })), 30);

    expect(slides).toHaveLength(1);
    expect(slides[0].state.active).toBe(-1);
  });
});
