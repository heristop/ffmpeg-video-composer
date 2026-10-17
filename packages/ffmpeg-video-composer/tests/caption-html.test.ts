import { describe, expect, it } from 'vitest';
import { planSubtitles, type SubtitlePlan } from '@/core/captions/plan';
import { ENTRANCE_LEVELS, POP_LEVELS, type CaptionState } from '@/core/captions/caption-frames';
import { captionBand, captionHtml, captionLook, cssColor, type CaptionLook } from '@/core/captions/caption-html';
import { plateBounds } from '@/core/captions/plate';
import { measureText } from '@/core/captions/wrap';
import { prepareHtmlLayer } from '@/core/html/html-layer';
import type { LayerElement } from '@/core/html/html-element';
import type { Subtitles } from '@/schemas/subtitles.schemas';

const FRAME = { width: 1280, height: 720 };
const METRICS = { ascent: 0.935, descent: 0.25, weight: 300 };
const resolveText = (text: Record<string, string | undefined>): string => text.en ?? text.text ?? '';
const PALETTE = { base: '#FFFFFF', active: '#FFD400', crown: '#FF00AA', plate: '#101014@0.82' };

function plan(subtitles: Partial<Subtitles>): SubtitlePlan {
  const planned = planSubtitles(
    { cues: [{ at: 1, end: 3, text: 'Hello <big> {{world}} now' }], ...subtitles } as Subtitles,
    { frame: FRAME, resolveText }
  );

  if (!planned) throw new Error('no plan');

  return planned;
}

function look(planned: SubtitlePlan): CaptionLook {
  return captionLook(planned.style, PALETTE, planned.style.dna.effect);
}

const SETTLED: CaptionState = { cue: 0, active: -1, filled: 0, bump: 0, reveal: ENTRANCE_LEVELS };

// Every element of the prepared layer with its text, flattened.
function nodes(element: LayerElement): LayerElement[] {
  return [
    element,
    ...(element.props.children ?? []).flatMap((child) => (typeof child === 'string' ? [] : nodes(child))),
  ];
}

function text(element: LayerElement): string {
  return (element.props.children ?? []).filter((child) => typeof child === 'string').join('');
}

function render(planned: SubtitlePlan, state: CaptionState) {
  const band = captionBand(planned, FRAME, look(planned));
  const html = captionHtml({ plan: planned, state, look: look(planned), band, metrics: METRICS });
  const prepared = prepareHtmlLayer({ html, width: band.width, height: band.height }, 'Rubik');

  return { band, html, prepared, words: nodes(prepared.element).filter((node) => text(node) !== '') };
}

describe('cssColor', () => {
  it('turns FFmpeg colours into CSS', () => {
    expect(cssColor('#FF8000')).toBe('#FF8000');
    expect(cssColor('#FF8000@0.5')).toBe('rgba(255,128,0,0.5)');
    expect(cssColor('0x00ff00')).toBe('#00ff00');
    expect(cssColor('white@0.25')).toBe('white');
  });

  it('never lets a colour carry markup or extra declarations into the style attribute', () => {
    for (const hostile of [
      'red;background-image:url(http://x/y.png)',
      '#fff" onclick="x',
      'red}</div><script>',
      'a(b)',
    ]) {
      expect(cssColor(hostile)).toBe('#ffffff');
    }

    expect(cssColor('#fff@calc(1)')).toBe('#fff');
  });
});

describe('captionHtml', () => {
  it('lays every word out where the plan placed it, inside the supported HTML subset', () => {
    const planned = plan({ style: 'clean', karaoke: 'word' });
    const { band, prepared, words } = render(planned, SETTLED);
    const placed = planned.cues[0].lines.flatMap((line) => line.words);

    expect(prepared.findings).toEqual([]);
    // The face drawtext draws (Rubik's default instance), so glyph widths match the measured layout.
    expect(words.every((node) => node.props.style.fontWeight === '300')).toBe(true);
    expect(prepared.faces).toEqual([expect.objectContaining({ file: 'Rubik.ttf', weights: [300, 400, 700] })]);
    expect(words.map(text)).toEqual(placed.map((word) => word.text));
    expect(words.map((node) => Number.parseFloat(node.props.style.left))).toEqual(
      placed.map((word) => Number((word.x - band.x).toFixed(3)))
    );
  });

  it('escapes the copy, placeholders included', () => {
    const { html } = render(plan({}), SETTLED);

    expect(html).toContain('&lt;big&gt;');
    expect(html).not.toContain('{{');
  });

  it('puts the baseline where drawtext puts it', () => {
    const planned = plan({ style: 'clean' });
    const { band, words } = render(planned, SETTLED);
    const size = planned.cues[0].size;
    const top = Number.parseFloat(words[0].props.style.top);
    // line-height 1: the glyphs' ascent + descent centred in a box one size tall.
    const baseline = top + size * ((1 - (METRICS.ascent + METRICS.descent)) / 2 + METRICS.ascent);

    expect(baseline + band.y).toBeCloseTo(planned.cues[0].lines[0].baseline, 2);
  });

  it('colours the spoken word and leaves the others in the base colour', () => {
    const { words } = render(plan({ karaoke: 'word' }), { ...SETTLED, active: 1 });

    expect(words.map((node) => node.props.style.color)).toEqual(['#FFFFFF', '#FFD400', '#FFFFFF', '#FFFFFF']);
  });

  it('lights the words a fill has reached', () => {
    const { words } = render(plan({ karaoke: 'fill' }), { ...SETTLED, filled: 2 });

    expect(words.map((node) => node.props.style.color)).toEqual(['#FFD400', '#FFD400', '#FFFFFF', '#FFFFFF']);
  });

  it('grows a popping word around its own centre', () => {
    const planned = plan({ style: 'loud', karaoke: 'pop' });
    const peak = render(planned, { ...SETTLED, active: 0, bump: POP_LEVELS });
    const rest = render(planned, { ...SETTLED, active: 0, bump: 0 });
    const word = planned.cues[0].lines[0].words[0];
    const size = planned.cues[0].size;
    const grown = size * planned.style.activeScale;
    const left = Number.parseFloat(peak.words[0].props.style.left);
    const width = measureText(planned.style.font, word.text, grown) ?? 0;

    expect(Number.parseFloat(peak.words[0].props.style.fontSize)).toBeCloseTo(grown, 3);
    expect(Number.parseFloat(rest.words[0].props.style.fontSize)).toBeCloseTo(size, 3);
    expect(left + width / 2 + peak.band.x).toBeCloseTo(word.x + word.width / 2, 2);
  });

  it('draws the DNA outline as a stroke under the fill and its shadow as a text shadow', () => {
    const loud = render(plan({ style: 'loud' }), SETTLED);
    const clean = render(plan({ style: 'clean' }), SETTLED);

    expect(loud.words[0].props.style.WebkitTextStroke).toBe('10px #000000');
    expect(clean.words[0].props.style.textShadow).toMatch(/^2px 3px \d+px rgba\(0,0,0,0\.55\)$/);
  });

  // A blurred text shadow is the costliest thing a raster draws: a wide glow made neon ~15× slower than loud.
  it('caps a glow blur so its raster stays cheap', () => {
    const neon = render(plan({ style: 'neon', size: 120 }), SETTLED);
    const blur = Number(/^0px 0px (\d+)px /.exec(neon.words[0].props.style.textShadow)?.[1]);

    expect(blur).toBeGreaterThan(0);
    expect(blur).toBeLessThanOrEqual(8);
  });

  it('draws a rounded plate behind each line of a boxed DNA', () => {
    const planned = plan({ style: 'boxed', cues: [{ at: 1, end: 3, text: 'A much longer caption that will wrap' }] });
    const { band, prepared } = render(planned, SETTLED);
    const plates = nodes(prepared.element).filter((node) => Object.hasOwn(node.props.style, 'borderRadius'));
    const bounds = planned.cues[0].lines.map((line) =>
      plateBounds(line, planned.cues[0].size, planned.style.dna.box as NonNullable<typeof planned.style.dna.box>)
    );

    expect(plates).toHaveLength(planned.cues[0].lines.length);
    expect(plates.map((plate) => Number.parseFloat(plate.props.style.left) + band.x)).toEqual(
      bounds.map((bound) => bound.left)
    );
    expect(plates[0].props.style.borderRadius).toBe(`${bounds[0].radius}px`);
    expect(plates[0].props.style.backgroundColor).toBe('rgba(16,16,20,0.82)');
  });

  it('fades and lifts the cue while it enters', () => {
    const planned = plan({ style: 'neon' });
    const settled = render(planned, SETTLED);
    const entering = render(planned, { ...SETTLED, reveal: 2 });
    const lift =
      Number.parseFloat(entering.words[0].props.style.top) - Number.parseFloat(settled.words[0].props.style.top);

    expect(entering.words[0].props.style.opacity).toBe('0.5');
    expect(lift).toBeCloseTo(planned.style.dna.entrance.distance / 2, 3);
    expect(settled.words[0].props.style.opacity).toBeUndefined();
  });

  it('writes the same markup for the same state', () => {
    const planned = plan({ style: 'loud', karaoke: 'pop' });
    const state = { ...SETTLED, active: 1, bump: 1 };

    expect(render(planned, state).html).toBe(render(planned, state).html);
  });
});

describe('captionBand', () => {
  it('covers every cue with room for the effects, inside the frame', () => {
    const planned = plan({ style: 'loud', karaoke: 'pop' });
    const band = captionBand(planned, FRAME, look(planned));

    expect(Number.isInteger(band.x) && Number.isInteger(band.y)).toBe(true);
    expect(band.x).toBeGreaterThanOrEqual(0);
    expect(band.x + band.width).toBeLessThanOrEqual(FRAME.width);
    expect(band.y + band.height).toBeLessThanOrEqual(FRAME.height);

    for (const line of planned.cues[0].lines) {
      expect(line.x).toBeGreaterThan(band.x);
      expect(line.x + line.width).toBeLessThan(band.x + band.width);
      expect(line.top).toBeGreaterThan(band.y);
      expect(line.top + planned.cues[0].size).toBeLessThan(band.y + band.height);
    }
  });
});
