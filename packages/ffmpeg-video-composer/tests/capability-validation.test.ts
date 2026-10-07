import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_FEATURES,
  probedCapabilities,
  type CapabilityReport,
  type FeatureStatus,
} from '@/core/capabilities';
import { TemplateValidator } from '@/services/TemplateValidator';
import { templateFeatureUses } from '@/services/capability-validation';
import { applyFilterCompat, engineCapabilities, hasFilter } from '@/editor/utils/filter-compat';
import { boundaryTransitions } from '@/director/prepare-build';

function report(missing: Partial<Record<(typeof CAPABILITY_FEATURES)[number], string>>): CapabilityReport {
  const features = Object.fromEntries(
    CAPABILITY_FEATURES.map((id): [string, FeatureStatus] => [
      id,
      missing[id] ? { usable: 'no', detail: missing[id], fix: `fix ${id}` } : { usable: 'yes', detail: 'ok' },
    ])
  );

  return {
    ffmpeg: { path: '/opt/ffmpeg', version: '6.1' },
    features: features as CapabilityReport['features'],
    fonts: { bundled: null, freetype: false, fontconfig: false, harfbuzz: false, fribidi: false },
    encoders: ['libx264'],
  };
}

const template = {
  global: { transition: { type: 'fade', duration: 0.5 } },
  partials: [
    { id: 'card', sections: [{ name: 'p', type: 'color_background', options: { duration: 1 }, look: 'teal-orange' }] },
  ],
  sections: [
    {
      name: 'intro',
      type: 'color_background',
      options: { duration: 2 },
      caption: { text: { en: 'Hello' } },
      filters: [{ type: 'gblur', value: 'sigma=2' }],
    },
    { type: 'partial', ref: 'card' },
  ],
};

describe('feature_unavailable', () => {
  const validator = new TemplateValidator();

  it('says nothing without a capability report', () => {
    expect(validator.getCapabilityWarnings(template)).toEqual([]);
    expect(validator.getCapabilityWarnings(template, null)).toEqual([]);
  });

  it('says nothing when the backend runs every feature used', () => {
    expect(validator.getCapabilityWarnings(template, report({}))).toEqual([]);
  });

  it('flags each use of an unusable feature with the fix as hint', () => {
    const caps = report({ drawtext: 'no drawtext filter', xfade: 'no xfade filter', lut3d: 'broken', gblur: 'x' });
    const findings = validator.getCapabilityWarnings(template, caps);

    expect(findings.map((f) => [f.path, f.code])).toEqual([
      ['global.transition', 'feature_unavailable'],
      ['sections[0].filters[0]', 'feature_unavailable'],
      ['sections[0].caption', 'feature_unavailable'],
      ['sections[1].look', 'feature_unavailable'],
    ]);
    expect(findings[2].message).toContain('needs drawtext');
    expect(findings[2].message).toContain('/opt/ffmpeg');
    expect(findings[2].hint).toBe('fix drawtext');
  });

  it('ignores features the probe could not settle', () => {
    const caps = report({});
    caps.features.drawtext = { usable: 'unknown', detail: 'timed out' };

    expect(validator.getCapabilityWarnings(template, caps)).toEqual([]);
  });

  it('finds kinetic text, grade blur and loudnorm', () => {
    const uses = templateFeatureUses({
      global: { audio: { normalize: 'loudnorm' } },
      sections: [{ name: 'k', type: 'color_background', kinetic: [{ text: { en: 'a' } }], grade: { blur: 2 } }],
    }).map((use) => use.feature);

    expect(uses).toEqual(['loudnorm', 'drawtext', 'gblur']);
  });
});

describe('capability-driven degradation', () => {
  const caps = probedCapabilities(report({ drawtext: 'no drawtext filter', xfade: 'no xfade', gpl: 'LGPL' }));

  it('drops a filter the probed FFmpeg lacks instead of failing the render', () => {
    const engine = engineCapabilities({}, caps);

    expect(applyFilterCompat({ type: 'drawtext', values: { text: { en: 'x' } } }, engine)).toBeNull();
    expect(applyFilterCompat({ type: 'hue', value: 's=0' }, engine)).toEqual({ type: 'hue', value: 's=0' });
  });

  it('rewrites eq on a probed LGPL build', () => {
    const resolved = applyFilterCompat({ type: 'eq', value: 'contrast=1.1' }, engineCapabilities({}, caps));

    expect(resolved?.type).toBe('lutyuv');
  });

  it('reports a probed-missing filter as absent, so masks fall back instead of emitting alphamerge', () => {
    const engine = engineCapabilities({}, probedCapabilities(report({ alphamerge: 'no alphamerge' })));

    expect(hasFilter(engine, 'alphamerge')).toBe(false);
    expect(hasFilter(engine, 'overlay')).toBe(true);
  });

  it('keeps the unprobed capabilities unchanged', () => {
    expect(engineCapabilities({})).toMatchObject({ gpl: true, lut3d: true, textShaping: false, missingFilters: null });
  });

  it('cuts instead of crossfading when xfade is unavailable', () => {
    const sections = [
      { name: 'a', type: 'color_background' },
      { name: 'b', type: 'color_background' },
    ] as never;

    expect(boundaryTransitions(sections, { type: 'fade', duration: 0.5 }, false)).toEqual([
      { type: 'cut', duration: 0 },
    ]);
    expect(boundaryTransitions(sections, { type: 'fade', duration: 0.5 })[0].type).toBe('fade');
  });
});
