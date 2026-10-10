import { describe, expect, it, vi } from 'vitest';
import { subtitlesToFilters } from '@/editor/presets/subtitles';
import { htmlCaptionFilters } from '@/editor/presets/subtitles-html';
import type { ExtraInputSource, MaskSugarContext, SugarContext } from '@/editor/presets/sugar-context';
import { SubtitlesSchema, type Subtitles } from '@/schemas/subtitles.schemas';
import type { Filter } from '@/core/types';
import { TemplateValidator } from '@/services/TemplateValidator';

const resolveText = (text: Record<string, string | undefined>): string => text.en ?? text.text ?? '';

const TRACK: Subtitles = {
  words: [
    { text: 'Ship', start: 0.2, end: 0.5 },
    { text: 'it', start: 0.5, end: 0.7 },
    { text: 'faster.', start: 0.7, end: 1.2 },
  ],
  style: 'boxed',
  karaoke: 'word',
};

function masks(overrides: Partial<MaskSugarContext> = {}) {
  const inputs: Array<{ key: string; source: ExtraInputSource }> = [];
  const warn = vi.fn();
  const context: MaskSugarContext = {
    available: true,
    input: (key, source) => {
      inputs.push({ key, source });

      return `input:${key}`;
    },
    color: (color) => color,
    warn,
    htmlLayers: true,
    captions: htmlCaptionFilters,
    ...overrides,
  };

  return { context, inputs, warn };
}

function ctx(mask?: MaskSugarContext): SugarContext {
  return {
    duration: 4,
    scale: '1280:720',
    fps: 30,
    isVideo: true,
    motion: { energy: 1, seedFor: () => 1, resolveText },
    ...(mask && { masks: mask }),
  };
}

function types(filters: Filter[]): string[] {
  return [...new Set(filters.map((filter) => filter.type))];
}

describe('subtitles.renderer', () => {
  it('is drawbox by default and accepts html', () => {
    expect(SubtitlesSchema.safeParse(TRACK).success).toBe(true);
    expect(SubtitlesSchema.safeParse({ ...TRACK, renderer: 'html' }).success).toBe(true);
    expect(SubtitlesSchema.safeParse({ ...TRACK, renderer: 'drawbox' }).success).toBe(true);
    expect(SubtitlesSchema.safeParse({ ...TRACK, renderer: 'svg' }).success).toBe(false);
  });

  it('keeps the drawtext / drawbox lowering when the renderer is drawbox', () => {
    const { context, inputs } = masks();
    const filters = subtitlesToFilters(TRACK, ctx(context));

    expect(types(filters)).toEqual(['drawbox', 'drawtext']);
    expect(inputs).toEqual([]);
  });

  it('composites one raster track over the frame when the renderer is html', () => {
    const { context, inputs } = masks();
    const filters = subtitlesToFilters({ ...TRACK, renderer: 'html' }, ctx(context));

    expect(filters).toHaveLength(1);
    expect(filters[0].type).toBe('graph');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].key).toBe('subtitles');

    const source = inputs[0].source;

    if (!('captions' in source)) throw new Error('not a caption track');

    const { band, slides, fps } = source.captions;
    const chains = filters[0].graph ?? [];
    const overlay = chains.at(-1)?.filters[0];

    expect(fps).toBe(30);
    expect(slides.length).toBeGreaterThan(0);
    expect(chains.some((chain) => chain.inputs?.includes('input:subtitles'))).toBe(true);
    expect(overlay).toEqual({ type: 'overlay', value: `${band.x}:${band.y}` });
    expect(chains.flatMap((chain) => chain.filters.map((filter) => filter.type))).toEqual(['null', 'scale', 'overlay']);
  });

  it('falls back to drawbox where nothing can composite an extra input (validation)', () => {
    const filters = subtitlesToFilters({ ...TRACK, renderer: 'html' }, ctx());

    expect(types(filters)).toEqual(['drawbox', 'drawtext']);
  });

  it('falls back to drawbox with a warning where the host cannot draw HTML', () => {
    const { context, inputs, warn } = masks({ htmlLayers: false });
    const filters = subtitlesToFilters({ ...TRACK, renderer: 'html' }, ctx(context));

    expect(types(filters)).toEqual(['drawbox', 'drawtext']);
    expect(inputs).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('caption_html_unavailable'));
  });

  it('is advised against where the target host draws no HTML', () => {
    const template = {
      global: { orientation: 'landscape', musicEnabled: false },
      sections: [
        {
          name: 'talk',
          type: 'color_background',
          options: { backgroundColor: '#101010', duration: 2 },
          subtitles: { ...TRACK, renderer: 'html' },
        },
      ],
    };
    const validator = new TemplateValidator();
    const codes = (htmlLayers?: boolean) =>
      validator
        .getMotionWarnings(template, { textShaping: true, masks: true, htmlLayers })
        .filter((warning) => warning.code === 'caption_html_unavailable');

    expect(validator.validateTemplate(template).success).toBe(true);
    expect(codes(false)).toEqual([
      expect.objectContaining({ path: 'sections[0].subtitles.renderer', severity: 'warn' }),
    ]);
    expect(codes(true)).toEqual([]);
    expect(codes()).toEqual([]);
  });
});
