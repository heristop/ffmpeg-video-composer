import { describe, expect, it } from 'vitest';
import { MAX_FONT_FAMILIES, findPaletteDrift, parseHexColor } from '@/core/theme';
import { TemplateValidator } from '@/services/TemplateValidator';

function drawtext(values: Record<string, unknown>) {
  return { type: 'drawtext', values: { text: { en: 'Hi' }, fontsize: 40, x: 10, y: 10, ...values } };
}

function themed(theme: unknown, filters: unknown[], background = '$color.bg') {
  return {
    meta: { name: 'Palette' },
    global: { orientation: 'landscape', ...(theme === undefined ? {} : { theme }) },
    sections: [
      { name: 'intro', type: 'color_background', options: { backgroundColor: background, duration: 2 }, filters },
    ],
  };
}

const codes = (template: unknown) => findPaletteDrift(template as never).map((warning) => warning.message);

describe('parseHexColor', () => {
  it('reads #rgb, #rrggbb, #rrggbbaa, 0x and @alpha forms', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255]);
    expect(parseHexColor('#FF2E4D@0.5')).toEqual([255, 46, 77]);
    expect(parseHexColor('#ff2e4d80')).toEqual([255, 46, 77]);
    expect(parseHexColor('0x000000')).toEqual([0, 0, 0]);
    expect(parseHexColor('white')).toBeNull();
    expect(parseHexColor('$color.fg')).toBeNull();
  });
});

describe('palette_drift advisory', () => {
  it('is silent without a theme, and for token-only templates', () => {
    expect(findPaletteDrift(themed(undefined, [drawtext({ fontcolor: '#123456' })]) as never)).toEqual([]);
    expect(findPaletteDrift(themed('bold', [drawtext({ fontcolor: '$color.fg@0.8' })]) as never)).toEqual([]);
  });

  it('flags literal colours off the palette, once per section, listing each colour once', () => {
    const filters = [drawtext({ fontcolor: '#000000' }), drawtext({ fontcolor: '#000000@0.4', boxcolor: '#7b2ff7' })];
    const warnings = findPaletteDrift(themed('bold', filters) as never);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ path: 'sections[0]', code: 'palette_drift', severity: 'warn' });
    expect(warnings[0].message).toContain('#000000, #7b2ff7');
    expect(warnings[0].hint).toContain('$color.*');
  });

  it('accepts palette hexes regardless of alpha, case and near-identical shades', () => {
    const filters = [
      drawtext({ fontcolor: '#FF2E4D@0.5' }),
      drawtext({ fontcolor: '#ff2e4dcc' }),
      drawtext({ fontcolor: '#fd304b' }),
    ];

    expect(findPaletteDrift(themed('bold', filters, '#141416') as never)).toEqual([]);
    expect(codes(themed('bold', [drawtext({ fontcolor: '#e02040' })]))).toHaveLength(1);
  });

  it('checks global looks but not the theme object itself', () => {
    const template = themed({ extends: 'bold', colors: { accent: '#00ff00' } }, [drawtext({ fontcolor: '#00ff00' })]);
    const withGlobal = { ...template, global: { ...template.global, caption: { color: '#123456' } } };

    expect(findPaletteDrift(template as never)).toEqual([]);
    expect(findPaletteDrift(withGlobal as never).map((warning) => warning.path)).toEqual(['global']);
  });

  it(`flags more than ${MAX_FONT_FAMILIES} font families, collapsing ids, files and $font tokens`, () => {
    const two = [
      drawtext({ fontfile: '$font.display' }),
      drawtext({ fontfile: 'BebasNeue.ttf' }),
      { type: 'kinetic', font: 'oswald' },
    ];
    const three = [...two, drawtext({ fontfile: 'Anton.ttf' })];

    expect(findPaletteDrift(themed('bold', two) as never)).toEqual([]);

    const warnings = findPaletteDrift(themed('bold', three) as never);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('3 font families');
    expect(warnings[0].hint).toContain('$font.*');
  });

  it('rides along with the motion warnings and never fails validation', () => {
    const template = themed('bold', [drawtext({ fontcolor: '#ffffff' })], '#000000');
    const validator = new TemplateValidator();

    expect(validator.getMotionWarnings(template).find((w) => w.code === 'palette_drift')).toMatchObject({
      severity: 'warn',
      path: 'sections[0]',
    });
    expect(validator.getThemeWarnings(template as never).map((w) => w.code)).toContain('palette_drift');
    expect(validator.validateTemplate(template).success).toBe(true);
    expect(validator.getMotionWarnings(null)).toEqual([]);
  });
});
