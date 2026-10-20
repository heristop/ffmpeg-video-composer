import { describe, it, expect } from 'vitest';
import { captionToFilters } from '@/editor/presets/captions';
import type { Filter } from '@/core/types';
import type { Caption } from '@/schemas/template.schemas';

// ---------------------------------------------------------------------------
// captionToFilters
//
// The Translation `text` is emitted untouched onto `values.text`; FormatterManager
// resolves locale + {{ variables }} + escaping downstream (the shared drawtext text
// path), so these assertions check the emitted drawtext shape by construction.
// ---------------------------------------------------------------------------

describe('captionToFilters', () => {
  it('returns [] for undefined', () => {
    expect(captionToFilters(undefined)).toEqual([]);
  });

  it('returns [] for a caption whose text has no non-blank translation', () => {
    expect(captionToFilters({ text: { en: '   ' } })).toEqual([]);
    expect(captionToFilters({ text: {} })).toEqual([]);
  });

  // --- positions (default bar style) ---------------------------------------

  it('top position: y=60', () => {
    expect(captionToFilters({ text: { en: 'Hi' }, position: 'top' })).toEqual<Filter[]>([
      {
        type: 'drawtext',
        values: {
          text: { en: 'Hi' },
          x: '(w-text_w)/2',
          y: '60',
          fontfile: 'Oswald.ttf',
          fontsize: 46,
          fontcolor: '#f5f5f0',
          box: 1,
          boxcolor: '#141416@0.8',
          boxborderw: 18,
        },
      },
    ]);
  });

  it('center position: y=(h-text_h)/2', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, position: 'center' });
    expect((f.values as Record<string, unknown>).y).toBe('(h-text_h)/2');
  });

  it('bottom position: y=(h-text_h)-60', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, position: 'bottom' });
    expect((f.values as Record<string, unknown>).y).toBe('(h-text_h)-60');
  });

  it('lower-third position: y=(h-text_h)-110', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, position: 'lower-third' });
    expect((f.values as Record<string, unknown>).y).toBe('(h-text_h)-110');
  });

  it('defaults to lower-third position when position is omitted', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' } });
    expect((f.values as Record<string, unknown>).y).toBe('(h-text_h)-110');
  });

  // --- styles (default lower-third position) -------------------------------

  it('bar style: Oswald, boxed', () => {
    expect(captionToFilters({ text: { en: 'Hi' }, style: 'bar' })).toEqual<Filter[]>([
      {
        type: 'drawtext',
        values: {
          text: { en: 'Hi' },
          x: '(w-text_w)/2',
          y: '(h-text_h)-110',
          fontfile: 'Oswald.ttf',
          fontsize: 46,
          fontcolor: '#f5f5f0',
          box: 1,
          boxcolor: '#141416@0.8',
          boxborderw: 18,
        },
      },
    ]);
  });

  it('subtle style: Rubik, no box', () => {
    expect(captionToFilters({ text: { en: 'Hi' }, style: 'subtle' })).toEqual<Filter[]>([
      {
        type: 'drawtext',
        values: {
          text: { en: 'Hi' },
          x: '(w-text_w)/2',
          y: '(h-text_h)-110',
          fontfile: 'Rubik.ttf',
          fontsize: 44,
          fontcolor: '#ffffff',
        },
      },
    ]);
  });

  it('bold style: BebasNeue, no box', () => {
    expect(captionToFilters({ text: { en: 'Hi' }, style: 'bold' })).toEqual<Filter[]>([
      {
        type: 'drawtext',
        values: {
          text: { en: 'Hi' },
          x: '(w-text_w)/2',
          y: '(h-text_h)-110',
          fontfile: 'BebasNeue.ttf',
          fontsize: 72,
          fontcolor: '#ffffff',
        },
      },
    ]);
  });

  it('defaults to bar style when style is omitted', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' } });
    const values = f.values as Record<string, unknown>;
    expect(values.fontfile).toBe('Oswald.ttf');
    expect(values.box).toBe(1);
  });

  // --- overrides -----------------------------------------------------------

  it('align left: x=80', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, align: 'left' });
    expect((f.values as Record<string, unknown>).x).toBe('80');
  });

  it('align right: x=w-text_w-80', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, align: 'right' });
    expect((f.values as Record<string, unknown>).x).toBe('w-text_w-80');
  });

  it('align center (default): x=(w-text_w)/2', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, align: 'center' });
    expect((f.values as Record<string, unknown>).x).toBe('(w-text_w)/2');
  });

  it('font override (id): resolves to the bundled .ttf file', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, style: 'subtle', font: 'bebas' });
    expect((f.values as Record<string, unknown>).fontfile).toBe('BebasNeue.ttf');
  });

  it('font override (raw .ttf): passes through unchanged', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, font: 'Custom.ttf' });
    expect((f.values as Record<string, unknown>).fontfile).toBe('Custom.ttf');
  });

  it('unknown font override: falls back to the preset font', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, style: 'subtle', font: 'nope' });
    expect((f.values as Record<string, unknown>).fontfile).toBe('Rubik.ttf');
  });

  it('color override: replaces the preset fontcolor', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, color: '#f5c518' });
    expect((f.values as Record<string, unknown>).fontcolor).toBe('#f5c518');
  });

  it('fontsize override: replaces the preset fontsize', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, style: 'subtle', fontsize: 120 });
    expect((f.values as Record<string, unknown>).fontsize).toBe(120);
  });

  it('box off on a boxed preset: drops the box entirely', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, style: 'bar', box: false });
    const values = f.values as Record<string, unknown>;
    expect(values.box).toBeUndefined();
    expect(values.boxcolor).toBeUndefined();
    expect(values.boxborderw).toBeUndefined();
  });

  it('box on over a box-less preset: adds a box with the default colour/opacity', () => {
    expect(captionToFilters({ text: { en: 'Hi' }, style: 'subtle', box: true })).toEqual<Filter[]>([
      {
        type: 'drawtext',
        values: {
          text: { en: 'Hi' },
          x: '(w-text_w)/2',
          y: '(h-text_h)-110',
          fontfile: 'Rubik.ttf',
          fontsize: 44,
          fontcolor: '#ffffff',
          box: 1,
          boxcolor: '#000000@0.8',
          boxborderw: 18,
        },
      },
    ]);
  });

  it('boxColor + boxOpacity override: builds the colour@opacity token', () => {
    const [f] = captionToFilters({
      text: { en: 'Hi' },
      style: 'bar',
      boxColor: '#101010',
      boxOpacity: 0.5,
    });
    expect((f.values as Record<string, unknown>).boxcolor).toBe('#101010@0.5');
  });

  it('layers a full bespoke look (left/gold/bebas/custom-size, no box)', () => {
    expect(
      captionToFilters({
        text: { en: 'Ada Lovelace' },
        position: 'bottom',
        style: 'bold',
        align: 'left',
        font: 'bebas',
        fontsize: 90,
        color: '#f5c518',
        box: false,
      })
    ).toEqual<Filter[]>([
      {
        type: 'drawtext',
        values: {
          text: { en: 'Ada Lovelace' },
          x: '80',
          y: '(h-text_h)-60',
          fontfile: 'BebasNeue.ttf',
          fontsize: 90,
          fontcolor: '#f5c518',
        },
      },
    ]);
  });

  // --- reveal --------------------------------------------------------------

  it('reveal "fade": adds an alpha ramp, leaves x/y as placement', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, align: 'left', reveal: 'fade' });
    const values = f.values as Record<string, unknown>;
    expect(values.alpha).toBe(`'if(lt(t,0.3),0,if(lt(t,0.9),(t-0.3)/0.6,1))'`);
    expect(values.x).toBe('80');
  });

  it('reveal "slide-left": overrides x with a kinetic expression off the placement', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' }, align: 'left', reveal: 'slide-left' });
    const values = f.values as Record<string, unknown>;
    expect(values.x).toBe(`'(80)+round((1-(if(lt(t,0.3),0,if(lt(t,0.9),(t-0.3)/0.6,1))))*60)'`);
    expect(values.alpha).toBe(`'if(lt(t,0.3),0,if(lt(t,0.9),(t-0.3)/0.6,1))'`);
  });

  it('no reveal: no alpha emitted', () => {
    const [f] = captionToFilters({ text: { en: 'Hi' } });
    expect((f.values as Record<string, unknown>).alpha).toBeUndefined();
  });

  // --- purity & i18n -------------------------------------------------------

  it('preserves all translations on values.text (no pre-resolution)', () => {
    const [f] = captionToFilters({ text: { en: 'Hello', fr: 'Bonjour' } });
    expect((f.values as Record<string, unknown>).text).toEqual({ en: 'Hello', fr: 'Bonjour' });
  });

  it('purity: does not mutate the input and returns an independent text copy', () => {
    const caption: Caption = { text: { en: 'Hello' } };
    const [f] = captionToFilters(caption);
    (f.values as { text: Record<string, string> }).text.en = 'MUTATED';
    expect(caption.text.en).toBe('Hello');
  });
});
