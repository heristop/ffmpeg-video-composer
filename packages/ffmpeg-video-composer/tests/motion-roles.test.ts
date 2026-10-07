import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { TemplateValidator } from '@/services/TemplateValidator';
import { resolveMotionDescriptor, resolveTokens, BUILTIN_MOTION_TOKENS } from '@/core/motion/tokens';
import { BUILTIN_MOTION_ROLES, MOTION_ROLE_NAMES, curveOvershoot, headlineHoldSeconds } from '@/core/motion/roles';
import { motionCatalog } from '@/core/motion/catalog';
import { TemplateDescriptorSchema } from '@/schemas/template.schemas';

const EXPO = BUILTIN_MOTION_TOKENS.curves.expo;
const SMOOTH = BUILTIN_MOTION_TOKENS.curves.smooth;

type Loose = Record<string, any>;

function resolved(section: Loose, motion?: Loose): Loose {
  const descriptor = { global: { ...(motion && { motion }) }, sections: [section] };

  return (resolveMotionDescriptor(descriptor).sections as Loose[])[0];
}

function scene(fields: Loose): Loose {
  return { name: 's', type: 'color_background', options: { duration: 4 }, ...fields };
}

describe('motion role tokens', () => {
  it('exposes every built-in role as $role.<name> easing and duration tokens', () => {
    const tokens = resolveTokens(undefined);

    expect(tokens.easings['role.headline']).toBe(EXPO);
    expect(tokens.durations['role.headline']).toBe(0.7);
    expect(tokens.easings['role.camera']).toBe('ease-in-out-sine');
    expect(tokens.durations).not.toHaveProperty('role.camera');
    expect(tokens.easings['role.mascot']).toBe('spring(300, 14, 1, 0)');
  });

  it('lets global.motion.roles replace a role, resolving its own tokens', () => {
    const tokens = resolveTokens({ roles: { headline: { ease: '$smooth', duration: '$long' } } });

    expect(tokens.easings['role.headline']).toBe(SMOOTH);
    expect(tokens.durations['role.headline']).toBe(1.1);
    expect(tokens.easings['role.panel']).toBe(EXPO);
  });

  it('follows an overridden token a built-in role points at', () => {
    expect(resolveTokens({ curves: { expo: 'ease-out-quart' } }).easings['role.panel']).toBe('ease-out-quart');
  });

  it('resolves $role.<name> wherever an ease or a keyframe duration token is accepted', () => {
    const section = resolved(
      scene({
        kinetic: [{ text: { en: 'Hi' }, preset: 'rise', ease: '$role.panel' }],
        filters: [
          {
            type: 'drawtext',
            values: { text: 'x', x: 10, y: 10, fontsize: 40 },
            animate: {
              x: [
                { t: 0, v: 0 },
                { t: '+$role.micro', v: 100, ease: '$role.micro' },
              ],
            },
          },
        ],
      })
    );

    expect(section.kinetic[0].ease).toBe(EXPO);
    expect(section.filters[0].animate.x[1]).toEqual({ t: '+0.2', v: 100, ease: 'ease-out-cubic' });
  });
});

describe('role on elements', () => {
  it('fills ease and duration of a kinetic block that sets neither', () => {
    const block = resolved(scene({ kinetic: [{ text: { en: 'Hi' }, preset: 'cascade', role: 'headline' }] }))
      .kinetic[0];

    expect(block).toMatchObject({ ease: EXPO, duration: 0.7 });
  });

  it('lets an explicit ease win and keep its own timing', () => {
    const block = resolved(
      scene({ kinetic: [{ text: { en: 'Hi' }, preset: 'cascade', role: 'headline', ease: '$bouncy' }] })
    ).kinetic[0];

    expect(block.ease).toBe('spring(300, 14, 1, 0)');
    expect(block).not.toHaveProperty('duration');
  });

  it('keeps an explicit duration and still supplies the curve', () => {
    const block = resolved(
      scene({ kinetic: [{ text: { en: 'Hi' }, preset: 'cascade', role: 'headline', duration: 0.3 }] })
    ).kinetic[0];

    expect(block).toMatchObject({ ease: EXPO, duration: 0.3 });
  });

  it('uses the template override of a role', () => {
    const block = resolved(scene({ kinetic: [{ text: { en: 'Hi' }, preset: 'rise', role: 'headline' }] }), {
      roles: { headline: { ease: 'ease-out-quint', duration: 0.9 } },
    }).kinetic[0];

    expect(block).toMatchObject({ ease: 'ease-out-quint', duration: 0.9 });
  });

  it('gives title cards and lower thirds a reveal on the role curve', () => {
    const section = resolved(
      scene({
        titleCard: { headline: { en: 'Hi' }, role: 'headline' },
        lowerThird: { title: { en: 'Name' }, reveal: 'fade', role: 'panel' },
      })
    );

    expect(section.titleCard.reveal).toEqual({ type: 'rise', easing: EXPO, duration: 0.7 });
    expect(section.lowerThird.reveal).toEqual({ type: 'fade', easing: EXPO, duration: 0.55 });
  });

  it('applies to drawtext reveal, exit and animate keys, never to a none phase', () => {
    const filter = resolved(
      scene({
        filters: [
          {
            type: 'drawtext',
            role: 'micro',
            values: { text: 'x', x: 10, y: 10, fontsize: 40 },
            reveal: 'fade',
            exit: { type: 'none' },
            animate: { y: [{ v: 0 }, { v: 20 }, { v: 40, ease: 'linear' }] },
          },
        ],
      })
    ).filters[0];

    expect(filter.reveal).toEqual({ type: 'fade', easing: 'ease-out-cubic', duration: 0.2 });
    expect(filter.exit).toEqual({ type: 'none' });
    expect(filter.animate.y.map((key: Loose) => key.ease)).toEqual([undefined, 'ease-out-cubic', 'linear']);
  });

  it('gives graphics and the camera their role curve', () => {
    const section = resolved(
      scene({
        graphics: [{ type: 'panel', role: 'panel' }],
        camera: { preset: 'push-in', role: 'camera', zoom: [{ v: 1 }, { v: 1.1 }] },
      })
    );

    expect(section.graphics[0]).toMatchObject({ ease: EXPO, duration: 0.55 });
    expect(section.camera.ease).toBe('ease-in-out-sine');
    expect(section.camera).not.toHaveProperty('duration');
    expect(section.camera.zoom[1].ease).toBe('ease-in-out-sine');
  });

  it('leaves a descriptor without roles untouched', () => {
    const section = scene({ kinetic: [{ text: { en: 'Hi' }, preset: 'cascade' }], camera: { preset: 'push-in' } });

    expect(resolved(section)).toEqual(section);
  });
});

describe('role validation', () => {
  function errors(descriptor: unknown) {
    return new TemplateValidator().validateTemplate(descriptor).errors ?? [];
  }

  const valid = {
    global: { orientation: 'landscape', motion: { roles: { mascot: { ease: '$wobbly', overshoot: 'playful' } } } },
    sections: [scene({ kinetic: [{ text: { en: 'Hi' }, preset: 'pop', role: 'mascot', ease: '$role.accent' }] })],
  };

  it('accepts roles, role fields and $role tokens', () => {
    expect(TemplateDescriptorSchema.safeParse(valid).success).toBe(true);
    expect(errors(valid)).toEqual([]);
  });

  it('reports an unknown $role token with a role suggestion', () => {
    const typo = { sections: [scene({ kinetic: [{ text: { en: 'Hi' }, preset: 'rise', ease: '$role.panle' }] })] };
    const finding = errors(typo).find((error) => error.code === 'unknown_motion_token');

    expect(finding?.suggestion).toBe('$role.panel');
  });

  it('rejects a role ease that points at a role, and unknown role duration tokens', () => {
    const bad = {
      global: { motion: { roles: { panel: { ease: '$role.micro' }, micro: { ease: 'linear', duration: '$nope' } } } },
      sections: [],
    };
    const paths = errors(bad)
      .filter((error) => error.code === 'invalid_motion_token')
      .map((error) => error.path)
      .sort();

    expect(paths).toEqual(['global.motion.roles.micro.duration', 'global.motion.roles.panel.ease']);
  });

  it('rejects an unknown role name on an element', () => {
    const bad = { sections: [scene({ kinetic: [{ text: { en: 'Hi' }, preset: 'rise', role: 'hero' }] })] };

    expect(TemplateDescriptorSchema.safeParse(bad).success).toBe(false);
  });
});

describe('overshoot and hold helpers', () => {
  it('measures overshoot from the curve sampler', () => {
    expect(curveOvershoot('spring(300, 14)')).toBeGreaterThan(0.2);
    expect(curveOvershoot('spring(420, 30)')).toBeGreaterThan(0.01);
    expect(curveOvershoot('ease-out-back')).toBeGreaterThan(0.05);
    expect(curveOvershoot(EXPO)).toBe(0);
    expect(curveOvershoot('ease-out-cubic')).toBe(0);
    expect(curveOvershoot('ease-out-bounce')).toBe(0);
    expect(curveOvershoot('$unresolved')).toBe(0);
  });

  it('keeps the built-in roles within their declared overshoot budget', () => {
    const tokens = resolveTokens(undefined);

    for (const name of MOTION_ROLE_NAMES) {
      const overshoot = curveOvershoot(tokens.easings[`role.${name}`]);
      const budget = BUILTIN_MOTION_ROLES[name].overshoot;

      if (budget === 'none') expect(overshoot, name).toBeLessThanOrEqual(0.01);

      if (budget === 'playful') expect(overshoot, name).toBeGreaterThan(0.1);
    }
  });

  it('uses the catalog hold rule', () => {
    expect(headlineHoldSeconds(7)).toBeCloseTo(2.4);
  });

  it('lists every role with defaults and guidance in the motion catalog', () => {
    const { roles } = motionCatalog();

    expect(Object.keys(roles.defaults)).toEqual([...MOTION_ROLE_NAMES]);
    expect(roles.defaults.headline).toMatchObject({ ease: '$expo', duration: 0.7, overshoot: 'none' });
    expect(roles.defaults.mascot.useFor.length).toBeGreaterThan(0);
    expect(roles.warnings).toEqual(['overshoot_overuse', 'headline_hold_short']);
  });
});
