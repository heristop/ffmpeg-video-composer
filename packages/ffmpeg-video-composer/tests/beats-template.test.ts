import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { BaseTemplateValidator } from '@/services/BaseTemplateValidator';
import Template from '@/core/models/Template';
import { resolveTimeRefs } from '@/core/timing/resolve';
import { resolveSectionDurations } from '@/core/timing/durations';
import { applyMusicAnalysis, type MusicAnalysis } from '@/core/audio/apply-analysis';
import { prepareMotion } from '@/director/prepare-build';
import { motionCatalog } from '@/core/motion/catalog';

// global.beats as a measurement: section lengths in beats/bars, the { analyze: 'music' } request (deferred
// in validation on Node, refused on hosts that cannot analyze), the low-confidence advisory and putting an
// analysis into a template.

type Descriptor = { global?: Record<string, unknown>; sections: Array<Record<string, unknown>> };

function card(name: string, duration: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, type: 'color_background', options: { backgroundColor: '#101014', duration }, ...extra };
}

function template(beats: unknown, sections: Array<Record<string, unknown>>): Descriptor {
  return { global: { orientation: 'landscape', musicEnabled: false, ...(beats ? { beats } : {}) }, sections };
}

const HIT = { camera: { preset: 'push-in', amount: 0.05, hits: ['beat:9'] } };

describe('section lengths in beats and bars', () => {
  it('resolves { beats } and { bars } on the bpm grid, and starts later sections after them', () => {
    const descriptor = template({ bpm: 120, offset: 0, beatsPerBar: 3 }, [
      card('intro', { beats: 8 }),
      card('verse', { bars: 2 }, HIT),
    ]);
    const { descriptor: resolved, issues } = resolveTimeRefs(descriptor);
    const [intro, verse] = resolved.sections as Array<{ options: { duration: number }; camera: { hits: number[] } }>;

    expect(issues).toEqual([]);
    expect(intro.options.duration).toBe(4);
    expect(verse.options.duration).toBe(3);
    // Beat 9 = 4 s on the whole video = the start of the second section.
    expect(verse.camera.hits).toEqual([0]);
  });

  it('leaves sections without beat lengths untouched', () => {
    const descriptor = template({ bpm: 100 }, [card('a', 2)]);

    expect(resolveSectionDurations(descriptor).descriptor.sections[0]).toBe(descriptor.sections[0]);
  });

  it('is a validation error without a bpm on the grid', () => {
    const validator = new TemplateValidator();
    const noGrid = validator.validateTemplate(template(undefined, [card('a', { beats: 4 })]));
    const times = validator.validateTemplate(template({ times: [0, 0.5, 1] }, [card('a', { bars: 1 })]));

    for (const result of [noGrid, times]) {
      expect(result.success).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'beat_duration_needs_bpm', path: 'sections[0].options.duration' })
      );
    }
  });

  it('validates a template that counts its sections in beats', () => {
    const result = new TemplateValidator().validateTemplate(
      template({ bpm: 120 }, [card('a', { bars: 2 }), card('b', { beats: 4 }, HIT)])
    );

    expect(result.errors ?? []).toEqual([]);
  });

  it('rejects malformed beat lengths in the schema', () => {
    const result = new TemplateValidator().validateTemplate(template({ bpm: 120 }, [card('a', { beats: -1 })]));

    expect(result.success).toBe(false);
  });
});

describe('global.beats { analyze: "music" }', () => {
  const requested = (): Descriptor => ({
    ...template({ analyze: 'music' }, [card('intro', { bars: 2 }), card('drop', 4, HIT)]),
    global: { orientation: 'landscape', beats: { analyze: 'music' }, music: { name: 'clicks' } },
  });

  it('validates on Node: references on the grid wait for the analysis', () => {
    const result = new TemplateValidator().validateTemplate(requested());

    expect(result.errors ?? []).toEqual([]);
  });

  it('is beats_analysis_unavailable where the engine cannot analyze music', () => {
    const result = new BaseTemplateValidator({ beatsAnalysis: false }).validateTemplate(requested());

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'beats_analysis_unavailable', path: 'global.beats' }),
    ]);
    expect(result.errors?.[0].hint).toMatch(/leclap beats|analyze_music/);
  });

  it('is refused by the browser / on-device Template model', () => {
    const result = new Template().setDescriptor(requested());

    expect(result.errors?.map((error) => error.code)).toContain('beats_analysis_unavailable');
  });

  it('fails a build that reaches the time-reference pass unmeasured', () => {
    expect(() => prepareMotion(requested())).toThrow(/global\.beats.*analyze/);
  });

  it('builds once the analysis filled the grid in', () => {
    const analysis: MusicAnalysis = {
      bpm: 120,
      offset: 0.5,
      beatsPerBar: 4,
      confidence: 5,
      usable: true,
      cues: { drop: 4.5, end: 30 },
    };
    const prepared = prepareMotion(applyMusicAnalysis(requested(), analysis)) as Descriptor;
    const [intro, drop] = prepared.sections as Array<{
      options: { duration: number };
      cues?: unknown;
      camera?: { hits: number[] };
    }>;

    expect(prepared.global?.beats).toEqual({ bpm: 120, offset: 0.5, beatsPerBar: 4, confidence: 5, usable: true });
    expect(intro.options.duration).toBe(4);
    // Beat 9 = 0.5 + 8 × 0.5 = 4.5 s, 0.5 s into the second section — where the drop cue lands too.
    expect(drop.camera?.hits).toEqual([0.5]);
    expect(drop.cues).toEqual({ drop: 0.5 });
  });
});

describe('applyMusicAnalysis', () => {
  const analysis: MusicAnalysis = {
    bpm: 100,
    offset: 0.2,
    beatsPerBar: 4,
    confidence: 4.2,
    usable: true,
    cues: { build: 2, drop: 6.2, end: 20 },
  };

  it('fills a missing grid and the drop cue of the section playing then', () => {
    const out = applyMusicAnalysis(template(undefined, [card('a', 4), card('b', 4)]), analysis);

    expect(out.global?.beats).toMatchObject({ bpm: 100, offset: 0.2 });
    expect(out.sections[0].cues).toBeUndefined();
    expect(out.sections[1].cues).toEqual({ drop: 2.2 });
  });

  it('never overrides an authored grid or cue', () => {
    const authored = template({ bpm: 90 }, [card('a', 4), card('b', 4, { cues: { drop: 1 } })]);
    const out = applyMusicAnalysis(authored, analysis);

    expect(out.global?.beats).toEqual({ bpm: 90 });
    expect(out.sections[1].cues).toEqual({ drop: 1 });
  });

  it('adds an unusable grid only when the template asked for one', () => {
    const calm = { ...analysis, usable: false, confidence: 1.1, cues: { end: 20 } };

    expect(applyMusicAnalysis(template(undefined, [card('a', 4)]), calm).global?.beats).toBeUndefined();
    expect(applyMusicAnalysis(template({ analyze: 'music' }, [card('a', 4)]), calm).global?.beats).toMatchObject({
      usable: false,
    });
  });

  it('skips the drop cue when no section is known to be playing then', () => {
    const out = applyMusicAnalysis(template(undefined, [card('a', 4)]), analysis);

    expect(out.sections[0].cues).toBeUndefined();
  });
});

describe('beat_grid_low_confidence', () => {
  it('warns about an analysed grid without a reliable pulse', () => {
    const warnings = new TemplateValidator().getMotionWarnings(
      template({ bpm: 92, offset: 0.1, confidence: 1.4, usable: false }, [card('a', 4)])
    );

    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'beat_grid_low_confidence', path: 'global.beats', severity: 'warn' })
    );
    expect(warnings.find((w) => w.code === 'beat_grid_low_confidence')?.hint).toMatch(/phrases/);
  });

  it('stays quiet for a usable or hand-written grid', () => {
    const validator = new TemplateValidator();

    for (const beats of [{ bpm: 120 }, { bpm: 120, confidence: 5, usable: true }]) {
      const codes = validator.getMotionWarnings(template(beats, [card('a', 4)])).map((w) => w.code);

      expect(codes).not.toContain('beat_grid_low_confidence');
    }
  });
});

describe('motion catalog', () => {
  it('tells agents how to measure the grid and when not to use it', () => {
    const { timing } = motionCatalog();

    expect(timing.analysis.measure).toMatch(/leclap beats.*analyze_music/);
    expect(timing.analysis.lowConfidence).toMatch(/pace by phrases/);
    expect(timing.errors).toEqual(expect.arrayContaining(['beat_duration_needs_bpm', 'beats_analysis_unavailable']));
  });
});
