import { describe, it, expect, vi } from 'vitest';
import { EffectReferenceSchema } from '@/schemas/effect-reference.schema';
import { EffectSectionSchema } from '@/schemas/section.schemas';
import { TemplateValidator } from '@/services/TemplateValidator';
import { resolveTemplateEffects } from '@/core/resolve-template-effects';

const effect = () => ({
  type: 'effect' as const,
  name: 'intro',
  effect: { id: 'leclap/title-card', version: '1.0.0', props: { text: 'Hi', nested: [null, true, 1] }, assets: {} },
  options: { duration: 2 },
});
const rendered = () => ({ path: '/render/intro.mp4', metadata: { duration: 2 }, provenance: { backend: 'test' } });

describe('effect authoring contract', () => {
  it('accepts JSON props and an exact version', () => {
    expect(EffectReferenceSchema.parse(effect().effect)).toEqual(effect().effect);
    expect(EffectReferenceSchema.safeParse({ ...effect().effect, id: 'leclap.title-reveal' }).success).toBe(true);
    expect(new TemplateValidator().validateTemplate({ sections: [effect()] }).success).toBe(true);
  });

  it.each(['', '../bad', 'bad id', '/absolute'])('rejects unsafe identifiers %s', (id) => {
    expect(EffectReferenceSchema.safeParse({ ...effect().effect, id }).success).toBe(false);
  });

  it.each(['latest', '^1.0.0', '1.0', '01.0.0', '1.0.0-01'])('rejects non-exact semver %s', (version) => {
    expect(EffectReferenceSchema.safeParse({ ...effect().effect, version }).success).toBe(false);
  });

  it('rejects unknown reference fields and non-JSON props', () => {
    for (const invalid of [
      { extra: true },
      { props: [] },
      { props: { value: undefined } },
      { props: { value: () => 1 } },
      { assets: { logo: 1 } },
    ]) {
      expect(EffectReferenceSchema.safeParse({ ...effect().effect, ...invalid }).success).toBe(false);
    }
  });

  it.each([undefined, 0, -1, Infinity, NaN])('requires a positive finite duration (%s)', (duration) => {
    expect(EffectSectionSchema.safeParse({ ...effect(), options: { duration } }).success).toBe(false);
  });

  it('requires a name and rejects ambiguous media sources', () => {
    expect(EffectSectionSchema.safeParse({ ...effect(), name: ' ' }).success).toBe(false);
    for (const key of ['useVideoSection', 'videoUrl', 'pictureUrl']) {
      expect(EffectSectionSchema.safeParse({ ...effect(), options: { duration: 2, [key]: '/clip' } }).success).toBe(
        false
      );
    }
    expect(new TemplateValidator().validateTemplate({ sections: [{ ...effect(), type: 'unknown' }] }).success).toBe(
      false
    );
  });

  it('counts effects when checking transitions', () => {
    const validator = new TemplateValidator();
    const intro = { ...effect(), transition: { type: 'fade', duration: 0.5 } };
    expect(
      validator.validateTemplate({
        sections: [intro, { type: 'color_background', name: 'end', options: { duration: 2 } }],
      }).success
    ).toBe(true);
    expect(validator.validateTemplate({ sections: [intro] }).errors?.[0].code).toBe('dangling_transition');
  });
});

describe('resolveTemplateEffects', () => {
  it('expands partials, preserves compositing options and returns clip provenance without mutating input', async () => {
    const section = {
      ...effect(),
      options: { duration: 2, muteSection: true },
      look: 'warm' as const,
      filters: [{ type: 'vflip' }],
      transition: { type: 'fade' as const, duration: 0.5 },
    };
    const ordinary = { type: 'color_background', name: 'end', options: { duration: 2 } };
    const template = {
      global: { fps: 30 },
      sections: [{ type: 'partial', ref: 'title', prefix: 'a-' }, ordinary],
      partials: [{ id: 'title', sections: [section] }],
    };
    const before = structuredClone(template);
    const render = vi.fn(rendered);
    const result = await resolveTemplateEffects(template, render);
    expect(result.descriptor.sections).toEqual([
      { ...section, name: 'a-intro', type: 'project_video', effect: undefined },
      ordinary,
    ]);
    expect(result.userVideoPaths).toEqual({ 'a-intro': '/render/intro.mp4' });
    expect(result.provenance['a-intro']).toMatchObject({
      effect: section.effect,
      metadata: { duration: 2 },
      provenance: { backend: 'test' },
    });
    expect(template).toEqual(before);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('runs every preflight before any rendering, failing atomically on unknown effects', async () => {
    const render = vi.fn(rendered);
    const preflight = vi.fn((section) => {
      if (section.name === 'bad') throw new Error('unknown_effect');
    });
    await expect(
      resolveTemplateEffects({ sections: [effect(), { ...effect(), name: 'bad' }] }, render, { preflight })
    ).rejects.toThrow('unknown_effect');
    expect(preflight).toHaveBeenCalledTimes(2);
    expect(render).not.toHaveBeenCalled();
  });

  it('rejects duplicate visual names before rendering', async () => {
    const render = vi.fn(rendered);
    await expect(
      resolveTemplateEffects({ sections: [effect(), { type: 'project_video', name: 'intro' }] }, render)
    ).rejects.toThrow('duplicate');
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    { path: '', metadata: { duration: 2 } },
    { path: '/clip', metadata: { duration: 3 } },
    { path: '/clip', metadata: { duration: NaN } },
  ])('rejects invalid render output %j', async (output) => {
    await expect(resolveTemplateEffects({ sections: [effect()] }, () => output)).rejects.toThrow(/intro/);
  });

  it('resolves nested partial effects after every expanded effect passes preflight', async () => {
    const events: string[] = [];
    const render = vi.fn((section) => {
      events.push(`render:${section.name}`);

      return { ...rendered(), path: `/render/${section.name}.mp4` };
    });
    const preflight = vi.fn((section) => {
      events.push(`preflight:${section.name}`);
    });
    const template = {
      sections: [
        effect(),
        { type: 'partial', sections: [{ type: 'partial', sections: [{ ...effect(), name: 'nested' }] }] },
      ],
    };
    const before = structuredClone(template);
    const result = await resolveTemplateEffects(template, render, { preflight });
    expect(events).toEqual(['preflight:intro', 'preflight:nested', 'render:intro', 'render:nested']);
    expect(result.descriptor.sections).toEqual([
      { type: 'project_video', name: 'intro', options: { duration: 2 } },
      { type: 'project_video', name: 'nested', options: { duration: 2 } },
    ]);
    expect(result.userVideoPaths).toEqual({ intro: '/render/intro.mp4', nested: '/render/nested.mp4' });
    expect(result.provenance.nested.effect).toEqual(effect().effect);
    expect(template).toEqual(before);
  });

  it('rejects an unknown nested effect during preflight before rendering any clip', async () => {
    const render = vi.fn(rendered);
    const preflight = vi.fn((section) => {
      if (section.name === 'nested') throw new Error('unknown_effect');
    });
    await expect(
      resolveTemplateEffects(
        {
          sections: [effect(), { type: 'partial', ref: 'outer' }],
          partials: [
            { id: 'outer', sections: [{ type: 'partial', ref: 'inner' }] },
            { id: 'inner', sections: [{ ...effect(), name: 'nested' }] },
          ],
        },
        render,
        { preflight }
      )
    ).rejects.toThrow('unknown_effect');
    expect(preflight.mock.calls.map(([section]) => section.name)).toEqual(['intro', 'nested']);
    expect(render).not.toHaveBeenCalled();
  });

  it('validates the expanded descriptor before rendering', async () => {
    const render = vi.fn(rendered);
    await expect(
      resolveTemplateEffects(
        { sections: [{ type: 'partial', sections: [{ ...effect(), options: { duration: 0 } }] }] },
        render
      )
    ).rejects.toThrow('validation');
    expect(render).not.toHaveBeenCalled();
  });
});

describe('early unresolved effect guard', () => {
  it('applies partial variables before inspecting effect types and nested refs', async () => {
    const { assertEffectsResolved } = await import('@/core/assert-effects-resolved');
    for (const sections of [[{ ...effect(), type: '{{kind}}' }], [{ type: 'partial', ref: '{{target}}' }]]) {
      expect(() =>
        assertEffectsResolved({
          sections: [{ type: 'partial', ref: 'outer', variables: { kind: 'effect', target: 'title' } }],
          partials: [
            { id: 'outer', sections },
            { id: 'title', sections: [effect()] },
          ],
        })
      ).toThrow('effect_backend_unavailable');
    }
  });

  it('rechecks reused partials with different variables and terminates reference cycles', async () => {
    const { assertEffectsResolved } = await import('@/core/assert-effects-resolved');
    const descriptor = {
      sections: [
        { type: 'partial', ref: 'outer', variables: { target: 'empty' } },
        { type: 'partial', ref: 'outer', variables: { target: 'title' } },
      ],
      partials: [
        { id: 'outer', sections: [{ type: 'partial', ref: '{{target}}' }] },
        { id: 'empty', sections: [{ type: 'partial', ref: 'empty' }] },
        { id: 'title', sections: [effect()] },
      ],
    };
    expect(() => assertEffectsResolved({ ...descriptor, sections: descriptor.sections.slice(0, 1) })).not.toThrow();
    expect(() => assertEffectsResolved(descriptor)).toThrow('effect_backend_unavailable');
  });
});
