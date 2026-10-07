import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEMES,
  MAX_ACCENT_ELEMENTS,
  findAccentOveruse,
  parseThemeRef,
  resolveTheme,
  resolveThemeDescriptor,
  themeCatalog,
  validateTheme,
} from '@/core/theme';
import { contrastRatio, parseColor } from '@/core/color-contrast';
import { findFont } from '@/core/fonts';
import { motionCatalog } from '@/core/motion/catalog';
import { resolveMotionDescriptor } from '@/core/motion/tokens';
import { TemplateValidator } from '@/services/TemplateValidator';
import { GlobalConfigSchema } from '@/schemas/global.schemas';

function drawtext(values: Record<string, unknown>) {
  return { type: 'drawtext', values: { text: { en: 'Hi' }, fontsize: 40, x: 10, y: 10, ...values } };
}

function themed(theme: unknown, filters: unknown[], extra: Record<string, unknown> = {}) {
  return {
    meta: { name: 'Theme' },
    global: { orientation: 'landscape', ...(theme === undefined ? {} : { theme }), ...extra },
    sections: [
      { name: 'intro', type: 'color_background', options: { backgroundColor: '$color.bg', duration: 2 }, filters },
    ],
  };
}

describe('theme resolution', () => {
  it('parses whole-value tokens only', () => {
    expect(parseThemeRef('$color.accent')).toEqual({ namespace: 'color', name: 'accent' });
    expect(parseThemeRef('$color.fg@0.6')).toEqual({ namespace: 'color', name: 'fg', alpha: 0.6 });
    expect(parseThemeRef('$font.display')).toEqual({ namespace: 'font', name: 'display' });
    expect(parseThemeRef('c=$color.accent')).toBeNull();
    expect(parseThemeRef('$snappy')).toBeNull();
  });

  it('resolves colours, alpha and fonts by field', () => {
    const out = resolveThemeDescriptor(
      themed('midnight', [drawtext({ fontcolor: '$color.fg', fontfile: '$font.display', boxcolor: '$color.bg@0.55' })])
    );
    const section = out.sections[0];

    expect(section.options.backgroundColor).toBe('#0d1b2a');
    expect(section.filters[0]).toMatchObject({
      values: { fontcolor: '#f5f5f0', fontfile: 'BebasNeue.ttf', boxcolor: '#0d1b2a@0.55' },
    });
  });

  it('gives a font field the bundled id and a fontfile field the file', () => {
    const descriptor = {
      global: { theme: 'editorial', overlays: [{ text: { en: 'x' }, font: '$font.display' }] },
      sections: [{ name: 's', kinetic: [{ font: '$font.body' }], filters: [drawtext({ fontfile: '$font.display' })] }],
    };
    const out = resolveThemeDescriptor(descriptor) as any;

    expect(out.global.overlays[0].font).toBe('playfair');
    expect(out.sections[0].kinetic[0].font).toBe('oswald');
    expect(out.sections[0].filters[0].values.fontfile).toBe('PlayfairDisplay.ttf');
  });

  it('follows the extends chain, object over built-in over brand', () => {
    const theme = resolveTheme({ extends: 'neon', colors: { accent: '#ff0000' }, fonts: { mono: 'Custom.ttf' } });

    expect(theme?.colors).toMatchObject({ bg: '#17211d', accent: '#ff0000', accent2: '#FFF685' });
    expect(theme?.fonts).toEqual({ display: 'bebas', body: 'oswald', mono: 'Custom.ttf' });
    expect(theme?.name).toBe('neon');
    expect(resolveTheme({ colors: { bg: '#000000' } })?.colors.brand).toBe('#7C83FD');
    expect(resolveTheme('nope')).toBeUndefined();
    expect(resolveTheme({ extends: 'nope' })).toBeUndefined();
  });

  it('resolves against the brand theme when none is named, and leaves motion alone', () => {
    const out = resolveThemeDescriptor(themed(undefined, [drawtext({ fontcolor: '$color.brand' })]));

    expect(out.sections[0].filters[0]).toMatchObject({ values: { fontcolor: '#7C83FD' } });
    expect(out.global).not.toHaveProperty('motion');
  });

  it('is the identity on a template without tokens', () => {
    const plain = themed(undefined, [drawtext({ fontcolor: '#ffffff' })]);
    plain.sections[0].options.backgroundColor = '#000000';

    expect(resolveThemeDescriptor(plain)).toEqual(plain);
  });

  it('never rewrites tokens inside larger strings, the theme itself or global.motion', () => {
    const out = resolveThemeDescriptor(
      themed('bold', [{ type: 'geq', values: { r: 'X+$color.bg' } }], { motion: { curves: { x: 'linear' } } })
    );

    expect(out.sections[0].filters[0]).toMatchObject({ values: { r: 'X+$color.bg' } });
    expect(out.global.theme).toBe('bold');
  });
});

describe('theme motion defaults', () => {
  it('fills energy, $theme and $beat when global.motion leaves them unset', () => {
    const out = resolveThemeDescriptor(themed('bold', [])) as any;

    expect(out.global.motion).toEqual({
      energy: 1.3,
      curves: { theme: 'spring(420, 30, 1, 0)' },
      durations: { beat: 0.45 },
    });
  });

  it('never overrides explicit motion settings', () => {
    const motion = { energy: 0.5, curves: { theme: 'linear' }, durations: { beat: 2 } };
    const out = resolveThemeDescriptor(themed('bold', [], { motion })) as any;

    expect(out.global.motion).toEqual(motion);
  });

  it('feeds the motion pass: $theme and $beat resolve, travel scales by the theme energy', () => {
    const descriptor = themed({ extends: 'leclap', motion: { energy: 0.5, ease: 'ease-out-expo', beat: 0.3 } }, [
      { ...drawtext({}), reveal: { type: 'rise', easing: '$theme' }, animate: { x: [{ t: '$beat', v: 0 }] } },
    ]);
    const filter = resolveMotionDescriptor(resolveThemeDescriptor(descriptor)).sections[0].filters[0] as any;

    expect(filter.reveal).toEqual({ type: 'rise', easing: 'ease-out-expo', distance: 30 });
    expect(filter.animate.x[0].t).toBe(0.3);
  });
});

describe('theme validation', () => {
  const validator = new TemplateValidator();

  it('accepts a themed template', () => {
    const result = validator.validateTemplate(
      themed({ extends: 'midnight', fonts: { display: 'anton' } }, [
        drawtext({ fontcolor: '$color.accent', fontfile: '$font.display' }),
      ])
    );

    expect(result.errors).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('reports an unknown theme with the nearest name', () => {
    const errors = validateTheme(themed('midnite', []) as any);

    expect(errors).toEqual([
      { path: 'global.theme', code: 'unknown_theme', message: 'unknown theme "midnite"; did you mean "midnight"?' },
    ]);
    expect(validateTheme(themed({ extends: 'zzzzzzzzz' }, []) as any)[0]).toMatchObject({
      path: 'global.theme.extends',
      code: 'unknown_theme',
    });
  });

  it('reports unknown tokens with a suggestion', () => {
    const result = validator.validateTemplate(
      themed('neon', [drawtext({ fontcolor: '$color.acent', fontfile: '$font.dispaly', boxcolor: '$color.fg@3' })])
    );
    const codes = result.errors?.filter((error) => error.code === 'unknown_theme_token');

    expect(result.success).toBe(false);
    expect(codes?.map((error) => [error.path, error.message])).toEqual([
      ['sections[0].filters[0].values.fontcolor', 'unknown theme color "acent"; did you mean "accent"?'],
      ['sections[0].filters[0].values.fontfile', 'unknown theme font "dispaly"; did you mean "display"?'],
      ['sections[0].filters[0].values.boxcolor', '"$color.fg@3": alpha must be between 0 and 1'],
    ]);
  });

  it('reports partial tokens, fonts with alpha, bad theme fonts and eases', () => {
    const errors = validateTheme(
      themed({ fonts: { body: 'comic' }, motion: { ease: '$nope' } }, [
        drawtext({ fontcolor: 'x $color.fg', fontfile: '$font.body@0.5' }),
      ]) as any
    );

    expect(errors.map((error) => error.code)).toEqual([
      'unknown_font',
      'unknown_motion_token',
      'unknown_theme_token',
      'unknown_theme_token',
    ]);
  });

  it('rejects malformed theme objects at the schema', () => {
    expect(GlobalConfigSchema.safeParse({ theme: { colors: { bg: 'red' } } }).success).toBe(false);
    expect(GlobalConfigSchema.safeParse({ theme: { colors: { primary: '#000000' } } }).success).toBe(false);
    expect(GlobalConfigSchema.safeParse({ theme: { motion: { energy: 3 } } }).success).toBe(false);
    expect(GlobalConfigSchema.safeParse({ theme: 'neon' }).success).toBe(true);
  });
});

describe('accent_overuse advisory', () => {
  const bars = (count: number, color: string) =>
    Array.from({ length: count }, (_, index) => ({
      type: 'drawbox',
      values: { x: index, y: 0, w: 10, h: 10, c: color, t: 'fill' },
    }));

  it(`allows the accent on ${MAX_ACCENT_ELEMENTS} elements and flags more`, () => {
    expect(findAccentOveruse(themed('bold', bars(MAX_ACCENT_ELEMENTS, '$color.accent')) as any)).toEqual([]);

    const warnings = findAccentOveruse(themed('bold', bars(3, '$color.accent@0.5')) as any);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: 'sections[0]', code: 'accent_overuse' });
  });

  it("counts the explicit theme's accent hex, and one element once", () => {
    const filters = [...bars(2, '#FF2E4D@1'), drawtext({ fontcolor: '$color.accent', boxcolor: '$color.accent' })];

    expect(findAccentOveruse(themed('bold', filters) as any)).toHaveLength(1);
    expect(findAccentOveruse(themed(undefined, bars(3, '#ff2e4d')) as any)).toEqual([]);
    expect(new TemplateValidator().getThemeWarnings(themed('bold', filters) as any)).toHaveLength(1);
  });

  it('never fails validation', () => {
    expect(new TemplateValidator().validateTemplate(themed('bold', bars(4, '$color.accent'))).success).toBe(true);
  });

  it('rides along with the motion warnings, with a hint', () => {
    const warnings = new TemplateValidator().getMotionWarnings(themed('bold', bars(4, '$color.accent')));

    expect(warnings.find((w) => w.code === 'accent_overuse')).toMatchObject({ severity: 'warn', path: 'sections[0]' });
  });
});

describe('theme catalog', () => {
  it('lists every built-in with resolved tokens, also inside the motion catalog', () => {
    const catalog = themeCatalog();

    expect(catalog.themes.map((theme) => theme.name)).toEqual(Object.keys(BUILTIN_THEMES));
    expect(catalog.themes.length).toBeGreaterThanOrEqual(4);

    for (const theme of catalog.themes) {
      expect(Object.keys(theme.colors)).toHaveLength(catalog.tokens.colors.length);
      expect(Object.keys(theme.fonts)).toHaveLength(catalog.tokens.fonts.length);
      expect(validateTheme({ global: { theme: theme.name } })).toEqual([]);
    }

    expect(motionCatalog().themes).toEqual(catalog);
  });
});

describe('built-in theme legibility', () => {
  const ratio = (a: string, b: string) => contrastRatio(parseColor(a)!.rgb, parseColor(b)!.rgb);

  it('ships the palette range agents pick from', () => {
    expect(Object.keys(BUILTIN_THEMES)).toEqual([
      'leclap',
      'midnight',
      'editorial',
      'bold',
      'neon',
      'paper',
      'sunset',
      'ocean',
      'mono',
      'candy',
      'retro',
      'corporate',
    ]);
  });

  it.each(Object.keys(BUILTIN_THEMES))('%s: text is WCAG AA on bg and every accent reads at 3:1', (name) => {
    const { colors, fonts } = resolveTheme(name)!;

    expect(ratio(colors.fg, colors.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colors.muted, colors.bg)).toBeGreaterThanOrEqual(4.5);

    for (const accent of [colors.brand, colors.accent, colors.accent2]) {
      expect(ratio(accent, colors.bg)).toBeGreaterThanOrEqual(3);
    }

    for (const font of Object.values(fonts)) expect(findFont(font)).toBeDefined();
  });
});
