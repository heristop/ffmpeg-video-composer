import { describe, expect, it } from 'vitest';
import { parseSrt } from '@/core/captions/srt';
import { DEFAULT_GROUP_RULES, evenWordTimings, groupWords, type WordTiming } from '@/core/captions/grouping';
import { fitCaption, measureText, shrinkSizes, wrapWords } from '@/core/captions/wrap';
import { isFunctionWord } from '@/core/captions/function-words';
import { holdCues, timedCues } from '@/core/captions/cues';
import { planSubtitles } from '@/core/captions/plan';
import { CAPTION_DNA, CAPTION_DNA_IDS, captionDnaCatalog } from '@/core/captions/dna';
import { captionArea, subtitleFontFile } from '@/core/captions/style';
import { subtitlesToFilters } from '@/editor/presets/subtitles';
import type { SugarContext } from '@/editor/presets/sugar-context';
import { SubtitlesSchema, type Subtitles } from '@/schemas/subtitles.schemas';
import { motionCatalog } from '@/core/motion/catalog';
import type { Filter } from '@/core/types';

const FRAME = { width: 1280, height: 720 };
const resolveText = (text: Record<string, string | undefined>): string => text.en ?? text.text ?? '';

function words(spec: string): WordTiming[] {
  // "Hello@0-0.4 world@0.45-0.9" → timings
  return spec.split(' ').map((token) => {
    const [text, times] = token.split('@');
    const [start, end] = times.split('-').map(Number);

    return { text, start, end };
  });
}

function ctx(overrides: Partial<SugarContext> = {}): SugarContext {
  return {
    duration: 6,
    scale: '1280:720',
    fps: 30,
    isVideo: false,
    motion: { energy: 1, seedFor: () => 1, resolveText },
    ...overrides,
  };
}

function values(filters: Filter[], type = 'drawtext'): Array<Record<string, unknown>> {
  return filters.filter((f) => f.type === type).map((f) => f.values as Record<string, unknown>);
}

describe('SRT parsing', () => {
  it('reads standard SubRip', () => {
    const srt =
      '1\n00:00:01,000 --> 00:00:02,500\nHello there\nfriend\n\n2\n00:00:03,000 --> 00:00:04,000\n<i>Bye</i>\n';

    expect(parseSrt(srt)).toEqual({
      cues: [
        { start: 1, end: 2.5, text: 'Hello there friend' },
        { start: 3, end: 4, text: 'Bye' },
      ],
      errors: [],
    });
  });

  it('tolerates BOM, CRLF, dots, missing hours and index, short millis, settings and WebVTT headers', () => {
    const srt =
      '﻿WEBVTT\r\n\r\nNOTE a comment\r\n\r\n00:01.5 --> 00:02.25 align:start\r\n{\\an8}One\r\n\r\n7\r\n0:00:03.000-->0:00:04,1\r\nTwo';

    const parsed = parseSrt(srt);

    expect(parsed.errors).toEqual([]);
    expect(parsed.cues).toEqual([
      { start: 1.5, end: 2.25, text: 'One' },
      { start: 3, end: 4.1, text: 'Two' },
    ]);
  });

  it('reports unreadable blocks and inverted times with their line', () => {
    const parsed = parseSrt('1\nnot a time\nText\n\n2\n00:00:05,000 --> 00:00:04,000\nBack');

    expect(parsed.cues).toEqual([]);
    expect(parsed.errors.map((e) => e.line)).toEqual([1, 5]);
    expect(parseSrt('').errors[0].message).toBe('no cues found');
  });
});

describe('word grouping', () => {
  it('breaks on sentence ends, pauses, comma pauses and maxWords', () => {
    const groups = groupWords(
      words(
        'One@0-0.2 two.@0.25-0.5 Three@0.55-0.8 four,@0.85-1 five@1.3-1.5 six@1.55-1.7 seven@2.4-2.6 a@2.65-2.7 b@2.75-2.8 c@2.85-2.9 d@2.95-3 e@3.05-3.1 f@3.15-3.2 g@3.25-3.3'
      )
    );

    expect(groups.map((g) => g.words.map((w) => w.text).join(' '))).toEqual([
      'One two.',
      'Three four,',
      'five six',
      'seven a b c d e',
      'f g',
    ]);
  });

  it('enters `lead` early, lingers, and never overlaps the next group', () => {
    const groups = groupWords(words('Hi.@1-1.4 Again.@1.5-2'));

    expect(groups[0].start).toBeCloseTo(1 - DEFAULT_GROUP_RULES.lead, 9);
    expect(groups[0].end).toBe(groups[1].start);
    expect(groups[1].start).toBe(1.42);
    expect(groups[1].end).toBeCloseTo(2 + DEFAULT_GROUP_RULES.linger, 9);
  });

  it('splits on maxSeconds and merges a short soft-cut run forward', () => {
    const rules = { ...DEFAULT_GROUP_RULES, maxWords: 2, minSeconds: 0.5 };
    const groups = groupWords(words('a@0-0.1 b@0.1-0.2 c@0.2-0.3 d@0.3-1.2'), rules);

    expect(groups.map((g) => g.words.length)).toEqual([4]);
  });

  it('shares a cue by character count', () => {
    const timings = evenWordTimings('a bbb', 0, 6);

    expect(timings).toEqual([
      { text: 'a', start: 0, end: 2 },
      { text: 'bbb', start: 2, end: 6 },
    ]);
  });
});

describe('caption wrapping and fitting', () => {
  const font = 'Rubik.ttf';
  const text = 'This is the story of how we built it from the ground up'.split(' ');

  it('measures characters outside the advance table as an "n"', () => {
    expect(measureText(font, 'a中b', 40)).toBeCloseTo(measureText(font, 'anb', 40) as number, 6);
    expect(measureText('Nope.ttf', 'a', 40)).toBeNull();
  });

  it('balanced keeps the greedy line count but evens the widths', () => {
    const greedy = wrapWords(text, font, 48, 900, 'greedy') as string[][];
    const balanced = wrapWords(text, font, 48, 900, 'balanced') as string[][];
    const widths = (lines: string[][]) => lines.map((l) => measureText(font, l.join(' '), 48) as number);

    expect(balanced).toHaveLength(greedy.length);
    expect(Math.max(...widths(balanced))).toBeLessThanOrEqual(Math.max(...widths(greedy)));
    expect(balanced.flat()).toEqual(text);
  });

  it('avoids ending a line on a function word and leaving an orphan', () => {
    const lines = wrapWords('We walked into the old house'.split(' '), font, 48, 420, 'balanced') as string[][];

    for (const line of lines.slice(0, -1)) expect(isFunctionWord(line.at(-1) as string)).toBe(false);
    expect(lines.every((line) => line.length > 1)).toBe(true);
    expect(isFunctionWord('L’', 'fr')).toBe(true);
    expect(isFunctionWord('maison', 'fr')).toBe(false);
    expect(isFunctionWord("l'", 'fr')).toBe(true);
    expect(isFunctionWord('Der', 'de')).toBe(true);
    expect(isFunctionWord('della', 'it')).toBe(true);
    expect(isFunctionWord('para', 'es')).toBe(true);
    expect(isFunctionWord('the,')).toBe(true);
  });

  it('shrinks until the copy fits maxLines, then reports overflow at the floor', () => {
    expect(shrinkSizes(60, 45)).toEqual([60, 56, 53, 50, 47, 45]);

    const fits = fitCaption({
      words: text,
      font,
      size: 60,
      minSize: 30,
      maxWidth: 1100,
      maxLines: 2,
      mode: 'balanced',
    });

    expect(fits?.overflow).toBe(false);
    expect(fits?.lines.length).toBeLessThanOrEqual(2);

    const overflow = fitCaption({
      words: text,
      font,
      size: 60,
      minSize: 58,
      maxWidth: 500,
      maxLines: 2,
      mode: 'balanced',
    });

    expect(overflow?.overflow).toBe(true);
    expect(overflow?.size).toBe(58);
  });
});

describe('subtitle plan', () => {
  const base: Subtitles = { words: words('Make@0.2-0.5 every@0.55-0.8 word@0.85-1.1 land.@1.15-1.6') };

  it('times cues from words, srt or authored cues, with offset and even timing', () => {
    expect(timedCues(base, resolveText)[0].words).toHaveLength(4);
    expect(timedCues({ srt: '00:00:01,000 --> 00:00:02,000\nHi you', offset: 0.5 }, resolveText)[0]).toMatchObject({
      start: 1.5,
      end: 2.5,
      words: [
        { text: 'Hi', start: 1.5 },
        { text: 'you', end: 2.5 },
      ],
    });

    const cue = timedCues(
      { cues: [{ at: 0, end: 0.82, text: { en: 'Make every' } }], words: base.words },
      resolveText
    )[0];

    expect(cue.words.map((w) => w.start)).toEqual([0.2, 0.55]);
    expect(timedCues({ ...base, timing: 'even' }, resolveText)[0].words[0].start).toBeCloseTo(0.12, 9);
  });

  it('holds short cues to minDuration without overlapping', () => {
    expect(
      holdCues(
        [
          { start: 0, end: 0.3 },
          { start: 0.8, end: 1 },
        ],
        1
      )
    ).toEqual([
      { start: 0, end: 0.8 },
      { start: 0.8, end: 1.8 },
    ]);
  });

  it('splits a cue that overflows maxLines into consecutive, word-timed cues', () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    const plan = planSubtitles(
      { cues: [{ at: 0, end: 8, text: long }], maxLines: 1, size: 60, minSize: 56 },
      { frame: FRAME, resolveText }
    );

    expect(plan?.cues.length).toBeGreaterThan(1);
    expect(plan?.cues.map((c) => c.lines.length).every((n) => n === 1)).toBe(true);
    expect(plan?.cues[0].start).toBe(0);
    expect(plan?.cues.at(-1)?.end).toBe(8);
    for (const [i, cue] of (plan?.cues ?? []).entries()) {
      if (i > 0) expect(cue.start).toBe(plan?.cues[i - 1].end);
    }
    expect(plan?.advisories.map((a) => a.code)).toContain('caption_split');
    expect(plan?.cues.flatMap((c) => c.lines.flatMap((l) => l.words.map((w) => w.text))).join(' ')).toBe(long);
  });

  it('respects the platform safe zones', () => {
    const portrait = { width: 1080, height: 1920 };
    const area = captionArea(portrait, 'bottom', 'tiktok');

    expect(area.right).toBeCloseTo(1080 * 0.14, 6);
    expect(area.bottom).toBeGreaterThanOrEqual(1920 * 0.22);

    const plan = planSubtitles({ ...base, position: 'bottom' }, { frame: portrait, platform: 'tiktok', resolveText });
    const line = plan?.cues[0].lines[0];

    expect((line?.x ?? 0) + (line?.width ?? 0)).toBeLessThanOrEqual(1080 - area.right);
    expect((line?.top ?? 0) + (plan?.cues[0].size ?? 0)).toBeLessThanOrEqual(1920 - area.bottom);
  });

  it('crowns the exclaimed (or final) cue, larger and in its own case', () => {
    const plan = planSubtitles(
      {
        style: 'loud',
        crown: 'auto',
        cues: [
          { at: 0, end: 1, text: 'We did it!' },
          { at: 1, end: 2, text: 'thanks' },
        ],
      },
      { frame: FRAME, resolveText }
    );

    expect(plan?.cues.map((c) => c.crowned)).toEqual([true, false]);
    expect(plan?.cues[0].size).toBeGreaterThan(plan?.cues[1].size ?? 0);
    expect(plan?.cues[0].lines[0].text).toBe('WE DID IT!');
  });

  it('is null when the font is not bundled', () => {
    expect(planSubtitles({ ...base, font: 'Custom.ttf' }, { frame: FRAME, resolveText })).toBeNull();
  });
});

describe('subtitle lowering', () => {
  const track: Subtitles = { words: words('Make@0.2-0.5 every@0.55-0.8 word@0.85-1.1 land.@1.15-1.6') };

  it('word karaoke: base words with a hole, the active word redrawn in the active colour', () => {
    const filters = subtitlesToFilters({ ...track, style: 'clean' }, ctx());
    const texts = values(filters);

    expect(texts).toHaveLength(8);
    expect(texts[0]).toMatchObject({
      text: 'Make',
      fontfile: 'Rubik.ttf',
      fontcolor: '#FFFFFF',
      enable: "'gte(t,0.12)*lt(t,2.2)*(1-gte(t,0.2)*lt(t,0.55))'",
      shadowcolor: '#000000@0.55',
    });
    expect(texts[1]).toMatchObject({ text: 'Make', fontcolor: '#FFF685', enable: "'gte(t,0.2)*lt(t,0.55)'" });
    expect(texts[1].x).toBe(texts[0].x);
    expect(String(texts[0].y)).toMatch(/-max_glyph_a/);
    expect(texts[0].alpha).toMatch(/^'/);
  });

  it('fill karaoke: base until spoken, active until the cue leaves', () => {
    const texts = values(subtitlesToFilters({ ...track, style: 'keynote' }, ctx()));

    expect(texts[0]).toMatchObject({ text: 'Make', fontcolor: '#FFFFFF@0.42', enable: "'gte(t,0.12)*lt(t,0.2)'" });
    expect(texts[1]).toMatchObject({ text: 'Make', fontcolor: '#FFFFFF', enable: "'gte(t,0.2)*lt(t,2.2)'" });
  });

  it('pop karaoke: an eased scale bump centred on the word, upper-cased', () => {
    const texts = values(subtitlesToFilters({ ...track, style: 'loud' }, ctx()));
    const active = texts[1];

    expect(texts[0].text).toBe('MAKE');
    expect(String(active.fontsize)).toMatch(/\*\(1\+0\.22\*sin\(3\.14159265\*\(if\(lt\(t,0\.2\)/);
    expect(String(active.x)).toMatch(/-text_w\/2'$/);
    expect(active.fontcolor).toBe('#FF8AAE');
    expect(active.bordercolor).toBe('#000000');
  });

  it('documentary: one drawtext per line, no karaoke', () => {
    const texts = values(subtitlesToFilters({ ...track, style: 'documentary' }, ctx()));

    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: 'Make every word land.', fontfile: 'Oswald.ttf' });
  });

  it('boxed: a seamless stepped plate per line behind the words', () => {
    const filters = subtitlesToFilters({ ...track, style: 'boxed' }, ctx());
    const boxes = values(filters, 'drawbox');

    expect(boxes).toHaveLength(7);
    expect(boxes[0].color).toBe('#141416@0.82');
    expect(filters.findIndex((f) => f.type === 'drawtext')).toBe(7);
    for (const box of boxes) expect(Number(box.w)).toBeGreaterThan(0);
  });

  it('resolves theme colours against global.theme', () => {
    const texts = values(subtitlesToFilters({ ...track, style: 'neon' }, ctx({ theme: 'midnight' })));

    expect(texts[0].bordercolor).toMatch(/^#[0-9A-Fa-f]{6}@0\.75$/);
  });

  it('is deterministic and empty without a track or motion context', () => {
    expect(subtitlesToFilters({ ...track }, ctx())).toEqual(subtitlesToFilters({ ...track }, ctx()));
    expect(subtitlesToFilters(undefined, ctx())).toEqual([]);
    expect(subtitlesToFilters(track, ctx({ motion: undefined }))).toEqual([]);
  });
});

describe('caption DNA', () => {
  it('ships at least six identities, all with bundled fonts, in the motion catalog', () => {
    expect(CAPTION_DNA_IDS.length).toBeGreaterThanOrEqual(6);
    for (const id of CAPTION_DNA_IDS) {
      expect(measureText(subtitleFontFile(CAPTION_DNA[id].font), 'a', 10)).not.toBeNull();
    }
    expect(captionDnaCatalog().map((entry) => entry.id)).toEqual(CAPTION_DNA_IDS);
    expect(motionCatalog().captions.styles.map((entry) => entry.id)).toEqual(CAPTION_DNA_IDS);
  });

  it('schema accepts a track and rejects an empty one or cues + srt', () => {
    expect(SubtitlesSchema.safeParse({ words: [], style: 'neon', karaoke: false }).success).toBe(true);
    expect(SubtitlesSchema.safeParse({ style: 'neon' }).success).toBe(false);
    expect(SubtitlesSchema.safeParse({ srt: 'x', cues: [] }).success).toBe(false);
    expect(SubtitlesSchema.safeParse({ words: [], style: 'nope' }).success).toBe(false);
  });
});
