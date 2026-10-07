import { describe, expect, it } from 'vitest';
import { planSubtitles, type PlacedCue, type PlacedLine, type PlacedWord } from '@/core/captions/plan';
import { CAPTION_DNA } from '@/core/captions/dna';
import { captionArea, subtitleFontFile } from '@/core/captions/style';
import { measureText } from '@/core/captions/wrap';
import type { Subtitles } from '@/schemas/subtitles.schemas';

const resolveText = (text: Record<string, string | undefined>): string => text.en ?? text.text ?? '';

const PORTRAIT = { width: 720, height: 1280 };
const LANDSCAPE = { width: 1280, height: 720 };

const COPY = [
  'What you say becomes what you do',
  'Every single word you say becomes the thing you do next',
  'Unbelievable extraordinary accomplishments happen',
  'Internationalization responsibilities overwhelm',
  'I do it',
];

interface Box {
  left: number;
  right: number;
}

interface Check {
  font: string;
  size: number;
  scale: number;
  outline: number;
  /** The safe width's edges. */
  left: number;
  right: number;
}

// The active word as the lowering draws it: scaled around its own centre (word karaoke rounds the size;
// pop peaks at size × scale, never above the rounded-up size).
function activeBox(word: PlacedWord, check: Check): Box {
  const scaled = measureText(check.font, word.text, Math.ceil(check.size * check.scale)) ?? 0;
  const centre = word.x + word.width / 2;

  return { left: centre - scaled / 2, right: centre + scaled / 2 };
}

// Two glyph boxes overlap once their outlines (drawn around each word) meet.
function overlaps(a: Box, b: Box, outline: number): boolean {
  return a.left - outline < b.right + outline && b.left - outline < a.right + outline;
}

// Every way the line breaks when each of its words is the spoken one.
function problems(line: PlacedLine, check: Check): string[] {
  return line.words.flatMap((word, index) => {
    const active = activeBox(word, check);
    const neighbours = [line.words[index - 1], line.words[index + 1]].filter(Boolean);
    const touching = neighbours
      .filter((other) => overlaps(active, { left: other.x, right: other.x + other.width }, check.outline))
      .map((other) => `"${word.text}" touches "${other.text}"`);
    const outside =
      line.words.length > 1 && (active.left < check.left - 1e-6 || active.right > check.right + 1e-6)
        ? [`"${word.text}" leaves the safe width`]
        : [];

    return [...touching, ...outside];
  });
}

function plan(track: Subtitles, frame: { width: number; height: number }): PlacedCue[] {
  const planned = planSubtitles(track, { frame, resolveText });

  expect(planned).not.toBeNull();

  return planned?.cues ?? [];
}

const cases = [
  { style: 'loud', karaoke: 'word' },
  { style: 'loud', karaoke: 'pop' },
  { style: 'neon', karaoke: 'word' },
] as const;

describe('scaled karaoke layout', () => {
  for (const { style, karaoke } of cases) {
    for (const [name, frame] of [
      ['portrait', PORTRAIT],
      ['landscape', LANDSCAPE],
    ] as const) {
      it(`${style} + ${karaoke} (${name}): the spoken word never touches its neighbours or leaves the safe width`, () => {
        const dna = CAPTION_DNA[style];
        const area = captionArea(frame, dna.position);
        const outline = 'outline' in dna.effect ? dna.effect.outline.width : 0;

        const lines = COPY.flatMap((text) =>
          plan({ style, karaoke, cues: [{ at: 0, end: 4, text }] }, frame).flatMap((cue) =>
            cue.lines.map((line) => ({ line, size: cue.size }))
          )
        );
        const found = lines.flatMap(({ line, size }) =>
          problems(line, {
            font: subtitleFontFile(dna.font),
            size,
            scale: dna.activeScale,
            outline,
            left: area.left,
            right: frame.width - area.right,
          })
        );

        expect(found).toEqual([]);
      });
    }
  }

  it('keeps the line centred with the reserved room', () => {
    const area = captionArea(PORTRAIT, 'center');
    const centre = (area.left + PORTRAIT.width - area.right) / 2;
    const [cue] = plan({ style: 'loud', karaoke: 'word', cues: [{ at: 0, end: 4, text: COPY[0] }] }, PORTRAIT);

    for (const line of cue.lines) {
      expect(line.x + line.width / 2).toBeCloseTo(centre, 6);
      expect(line.words[0].x).toBeGreaterThan(line.x);
      expect(line.words.at(-1)?.x ?? 0).toBeLessThan(line.x + line.width);
    }
  });

  it('lays out unscaled styles exactly as plain text', () => {
    const [cue] = plan({ style: 'clean', cues: [{ at: 0, end: 4, text: COPY[0] }] }, PORTRAIT);

    for (const line of cue.lines) {
      expect(line.width).toBeCloseTo(measureText('Rubik.ttf', line.text, cue.size) ?? 0, 6);
      expect(line.words[0].x).toBe(line.x);
    }
  });

  it('is deterministic', () => {
    const track: Subtitles = { style: 'loud', karaoke: 'word', cues: [{ at: 0, end: 4, text: COPY[1] }] };

    expect(plan(track, PORTRAIT)).toEqual(plan(track, PORTRAIT));
  });
});
