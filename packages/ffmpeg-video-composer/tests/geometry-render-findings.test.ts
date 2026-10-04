import { describe, it, expect } from 'vitest';
import { measureTemplate, staticFindings } from '@/services/geometry';
import {
  mergeRenderedFindings,
  probeTextFill,
  renderDescriptor,
  renderTargets,
} from '@/services/geometry/render-findings';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

const loadFont = async (): Promise<Uint8Array | null> => null;

function template(sections: Record<string, unknown>[], global: Record<string, unknown> = {}): TemplateDescriptor {
  return { global: { orientation: 'landscape', ...global }, sections } as unknown as TemplateDescriptor;
}

const card = (name: string, backgroundColor: string, extra: Record<string, unknown> = {}) => ({
  type: 'color_background',
  name,
  options: { duration: 2, backgroundColor },
  caption: { text: { en: 'Hello there' }, style: 'subtle', color: '#eeeeee' },
  ...extra,
});

describe('probeTextFill', () => {
  it('swaps a light fill for black and a dark one for white', () => {
    const command = `-vf "drawtext=text='Hi':fontcolor='#eeeeee',drawtext=text='Yo':fontcolor=black:alpha='1'"`;

    expect(probeTextFill(command)).toBe(
      `-vf "drawtext=text='Hi':fontcolor='#000000',drawtext=text='Yo':fontcolor='#ffffff':alpha='1'"`
    );
  });

  // An alpha suffix is dropped: the probe paints its glyphs opaque so every one of them shows up in
  // the diff, however faint the real text is.
  it('paints the probe opaque whatever alpha the real fill carries', () => {
    expect(probeTextFill(`drawtext=fontcolor='#ffffff@0.3'`)).toBe(`drawtext=fontcolor='#000000'`);
  });

  it('falls back to magenta for a colour it cannot read', () => {
    expect(probeTextFill(`drawtext=fontcolor=tomato`)).toBe(`drawtext=fontcolor='#ff00ff'`);
  });

  // Text is single-quoted and its colons escaped, so a caption that literally says `fontcolor=` is
  // left alone.
  it('never rewrites inside quoted text', () => {
    const command = `drawtext=text='set fontcolor=red here':fontcolor=white`;

    expect(probeTextFill(command)).toBe(`drawtext=text='set fontcolor=red here':fontcolor='#000000'`);
  });

  it('leaves drawbox colours and everything else untouched', () => {
    const command = `drawbox=x=0:y=0:w=iw:h=40:color='#eeeeee':t=fill`;

    expect(probeTextFill(command)).toBe(command);
  });
});

describe('renderTargets', () => {
  it('samples each piece of text at the moment it rests, relative to its own section', async () => {
    const measured = await measureTemplate(template([card('a', '#ffffff'), card('b', '#000000')]), loadFont);
    const targets = renderTargets(measured);

    expect(targets.map((t) => t.sectionName)).toEqual(['a', 'b']);
    expect(targets[1].offsetSec).toBeCloseTo(targets[0].offsetSec, 5);
    expect(targets[1].offsetSec).toBeLessThan(2);
  });

  // A project_video section shows the user's own recording, which does not exist at validation time.
  // The demo clip the engine would substitute is not what the viewer will see, so it is not measured.
  it('skips text over a user recording', async () => {
    const recorded = { type: 'project_video', name: 'clip', options: { duration: 2 }, caption: { text: { en: 'Hi' } } };
    const measured = await measureTemplate(template([recorded, card('a', '#ffffff')]), loadFont);

    expect(renderTargets(measured).map((t) => t.sectionName)).toEqual(['a']);
  });
});

describe('renderDescriptor', () => {
  it('keeps only the sections to measure and drops what only the final assembly draws', () => {
    const source = template(
      [card('a', '#ffffff', { transition: { type: 'fade', duration: 0.5 } }), card('b', '#000000')],
      {
        musicEnabled: true,
        transition: { type: 'fade', duration: 0.5 },
        watermark: { url: 'logo.png' },
        animations: [{ name: 'x' }],
      }
    );
    const reduced = renderDescriptor(source, new Set(['b']));

    expect(reduced.sections?.map((s) => (s as { name: string }).name)).toEqual(['b']);
    expect(reduced.global).toEqual({ orientation: 'landscape', musicEnabled: false });
  });

  it('keeps sections that never render, since they can define what the others draw', () => {
    const form = { type: 'form', name: 'details', options: { fields: [] } };
    const reduced = renderDescriptor(template([form, card('a', '#ffffff')]), new Set(['a']));

    expect(reduced.sections?.map((s) => (s as { name: string }).name)).toEqual(['details', 'a']);
  });
});

describe('mergeRenderedFindings', () => {
  const grey = { r: 238, g: 238, b: 238 };
  const white = { r: 255, g: 255, b: 255 };

  it('replaces a colour-token contrast finding with the one measured from pixels', async () => {
    const measured = await measureTemplate(template([card('a', '#ffffff')]), loadFont);
    const [target] = renderTargets(measured);
    const merged = mergeRenderedFindings(measured, [
      { target, contrast: { ratio: 1.16, text: grey, backdrop: white } },
    ]);

    expect(merged.map((w) => w.code)).toEqual(['text_low_contrast_rendered']);
    expect(merged[0]).toMatchObject({ path: 'sections[0].caption', approx: false, severity: 'warn' });
    expect(merged[0].message).toContain('1.2:1');
    expect(merged[0].message).toContain('#eeeeee on #ffffff');
  });

  // The whole point of rendering: a caption over an image is "unknown" to the static model, and a
  // render that finds it legible settles the question.
  it('drops the over-footage finding once pixels show the text reads', async () => {
    const photo = card('a', '#ffffff', { inputs: [{ name: 'p', type: 'image', url: 'pictures/p.png' }] });
    const measured = await measureTemplate(template([photo]), loadFont);
    const [target] = renderTargets(measured);

    expect(staticFindings(measured).map((w) => w.code)).toEqual(['text_unreadable_over_footage']);
    expect(
      mergeRenderedFindings(measured, [
        { target, contrast: { ratio: 12, text: white, backdrop: { r: 0, g: 0, b: 0 } } },
      ])
    ).toEqual([]);
  });

  // One frame of footage is not the footage: the static over-footage finding stays, and a rendered
  // one says which frame it looked at.
  it('keeps the static finding for moving footage, next to the frame it measured', async () => {
    const footage = {
      type: 'video',
      name: 'v',
      options: { duration: 2 },
      caption: { text: { en: 'Hi' }, style: 'subtle' },
    };
    const measured = await measureTemplate(template([footage]), loadFont);
    const [target] = renderTargets(measured);
    const merged = mergeRenderedFindings(measured, [{ target, contrast: { ratio: 1.5, text: white, backdrop: grey } }]);

    expect(merged.map((w) => w.code).toSorted()).toEqual([
      'text_low_contrast_rendered',
      'text_unreadable_over_footage',
    ]);
    expect(merged.find((w) => w.code === 'text_low_contrast_rendered')?.message).toContain('one frame of the footage');
  });

  it('keeps static findings for text the render could not find', async () => {
    const measured = await measureTemplate(template([card('a', '#ffffff')]), loadFont);
    const [target] = renderTargets(measured);

    expect(mergeRenderedFindings(measured, [{ target, contrast: null }]).map((w) => w.code)).toEqual([
      'text_low_contrast',
    ]);
  });

  it('leaves findings the render does not judge alone', async () => {
    const tiny = card('a', '#000000', {
      caption: { text: { en: 'Hi' }, style: 'subtle', color: '#ffffff', fontsize: 8 },
    });
    const measured = await measureTemplate(template([tiny]), loadFont);
    const [target] = renderTargets(measured);
    const merged = mergeRenderedFindings(measured, [
      { target, contrast: { ratio: 21, text: white, backdrop: { r: 0, g: 0, b: 0 } } },
    ]);

    expect(merged.map((w) => w.code)).toEqual(['text_too_small']);
  });
});

it('retains static effect overlays while measuring and refining ordinary sections', async () => {
  const effect = {
    type: 'effect',
    name: 'promo',
    options: { duration: 10 },
    filters: [{ type: 'drawtext', values: { text: { en: 'Generated footage caption' }, fontsize: 40, x: 20, y: 20 } }],
  };
  const measured = await measureTemplate(template([effect, card('card', '#ffffff')]), loadFont);
  const targets = renderTargets(measured);
  expect(targets.map((target) => target.sectionName)).toEqual(['card']);
  expect(renderDescriptor(measured.template, new Set(['card'])).sections?.map((section) => section.name)).toEqual([
    'card',
  ]);
  const warnings = mergeRenderedFindings(
    measured,
    targets.map((target) => ({
      target,
      contrast: { ratio: 10, text: { r: 0, g: 0, b: 0 }, backdrop: { r: 255, g: 255, b: 255 } },
    }))
  );
  expect(
    warnings.some(
      (warning) => warning.path.startsWith('sections[0].filters[0]') && warning.code === 'text_unreadable_over_footage'
    )
  ).toBe(true);
  expect(
    warnings.some((warning) => warning.path === 'sections[1].caption' && warning.code === 'text_low_contrast')
  ).toBe(false);
});
