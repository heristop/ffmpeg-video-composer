import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import { HTML_RASTERISER, type HtmlRasteriser } from '@/core/html/html-rasteriser';
import { TemplateValidator } from '@/services/TemplateValidator';
import { BaseTemplateValidator } from '@/services/BaseTemplateValidator';
import Template from '@/core/models/Template';
import type { TemplateDescriptor } from '@/schemas/template.schemas';
import { resolveFields } from '@/core/fields';
import { resolveThemeDescriptor } from '@/core/theme/resolve';

function template(input: Record<string, unknown>, global: Record<string, unknown> = {}): TemplateDescriptor {
  return {
    global: { orientation: 'landscape', musicEnabled: false, ...global },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 2 },
        inputs: [{ name: 'address_card', type: 'html', ...input }],
      },
    ],
  } as unknown as TemplateDescriptor;
}

const CARD = { html: '<div class="card"><p>Hi</p></div>', css: '.card { padding: 8px }', width: 720, height: 320 };

function errors(descriptor: TemplateDescriptor, validator: BaseTemplateValidator = new TemplateValidator()) {
  return validator.validateTemplate(descriptor).errors ?? [];
}

function advisories(descriptor: TemplateDescriptor): { code: string; path: string; message: string }[] {
  return new TemplateValidator().getMotionWarnings(descriptor).filter((warning) => warning.code.startsWith('html_'));
}

describe('html input schema', () => {
  it('accepts an html layer with its box and overlay options', () => {
    expect(errors(template({ ...CARD, options: { position: '64:560', motion: { type: 'rise' } } }))).toEqual([]);
  });

  it('requires html, width and height on an html input', () => {
    const found = errors(template({ html: '<p>x</p>' }));

    expect(found.map((error) => error.path)).toEqual(['sections.0.inputs.0.width', 'sections.0.inputs.0.height']);
    expect(errors(template({ width: 10, height: 10 })).map((error) => error.path)).toEqual([
      'sections.0.inputs.0.html',
    ]);
  });

  it('refuses html fields on other input types and a url on an html input', () => {
    const imageWithHtml = template({ ...CARD, type: 'image', url: 'a.png' });

    expect(errors(imageWithHtml).map((error) => error.path)).toEqual([
      'sections.0.inputs.0.html',
      'sections.0.inputs.0.css',
      'sections.0.inputs.0.width',
      'sections.0.inputs.0.height',
    ]);
    expect(errors(template({ ...CARD, url: 'a.png' })).map((error) => error.path)).toEqual(['sections.0.inputs.0.url']);
  });

  it('bounds the box: html_too_large past 1920 px', () => {
    const found = errors(template({ ...CARD, width: 2400 }));

    expect(found).toEqual([
      expect.objectContaining({
        code: 'html_too_large',
        path: 'sections[0].inputs[0].width',
        hint: expect.any(String),
      }),
    ]);
  });

  it('reports html_unavailable on engines without a rasteriser', () => {
    const browser = new BaseTemplateValidator({ htmlLayers: false });

    expect(errors(template(CARD), browser)).toEqual([
      expect.objectContaining({
        code: 'html_unavailable',
        path: 'sections[0].inputs[0]',
        // What each host does to lift it: the browser's loader option, the phone's registration.
        message: expect.stringMatching(/loadHtmlWasm.*registerHtmlRasteriser/),
        hint: expect.any(String),
      }),
    ]);
    expect(new Template().setDescriptor(template(CARD)).errors?.map((error) => error.code)).toEqual([
      'html_unavailable',
    ]);
  });

  it('lets the browser and on-device Template through once the host registered a rasteriser', () => {
    container.registerInstance<HtmlRasteriser>(HTML_RASTERISER, {
      version: 'test',
      render: () => Promise.reject(new Error('not drawn here')),
    });

    try {
      expect(new Template().setDescriptor(template(CARD)).errors).toBeUndefined();
    } finally {
      container.reset();
    }
  });
});

describe('html advisories', () => {
  it('names dropped markup and css', () => {
    const found = advisories(template({ ...CARD, html: '<p onclick="x()">Hi</p>', css: 'p { z-index: 2 }' }));

    expect(found).toEqual([
      expect.objectContaining({ code: 'html_unsupported_markup', path: 'sections[0].inputs[0].html' }),
      expect.objectContaining({ code: 'html_unsupported_css', path: 'sections[0].inputs[0].css' }),
    ]);
  });

  it('flags a font the registry does not know', () => {
    expect(advisories(template({ ...CARD, css: 'p { font-family: "Comic Sans MS" }' }))).toEqual([
      expect.objectContaining({ code: 'html_font_unknown', message: expect.stringContaining('Comic Sans MS') }),
    ]);
  });

  it('flags a placeholder nothing fills', () => {
    const descriptor = template({ ...CARD, html: '<p>{{ address }} {{ city }}</p>' }, { variables: { city: 'Lyon' } });

    expect(advisories(descriptor)).toEqual([
      expect.objectContaining({ code: 'html_missing_field', message: expect.stringContaining('address') }),
    ]);
  });

  it('resolves typed fields HTML-escaped and theme tokens inside css', () => {
    const descriptor = template(
      {
        ...CARD,
        html: '<p>{{ address }}</p>',
        css: '.card { background: $color.surface; font: 600 28px $font.display }',
      },
      { fields: { address: { type: 'text', default: '<b>12</b> rue', maxLength: 60 } }, theme: 'leclap' }
    );

    expect(errors(descriptor)).toEqual([]);
    expect(advisories(descriptor)).toEqual([]);
  });

  it('escapes typed field values placed in html, not in other strings', () => {
    const descriptor = template(
      { ...CARD, html: '<p>{{ address }}</p>', css: '.card { padding: 8px }' },
      { fields: { address: { type: 'text', default: '<b>12</b> & rue', maxLength: 60 } } }
    );
    const resolved = resolveFields(descriptor).descriptor as unknown as {
      sections: { inputs: { html: string }[] }[];
    };

    expect(resolved.sections[0].inputs[0].html).toBe('<p>&lt;b&gt;12&lt;/b&gt; &amp; rue</p>');
  });

  it('resolves theme tokens inside css and html as css values', () => {
    const descriptor = template(
      {
        ...CARD,
        html: '<p style="color: $color.accent@0.5">x</p>',
        css: '.card { background: $color.surface; font: 600 28px $font.display }',
      },
      { theme: 'leclap' }
    );
    const input = (resolveThemeDescriptor(descriptor) as unknown as { sections: { inputs: (typeof CARD)[] }[] })
      .sections[0].inputs[0];

    expect(input.css).toBe('.card { background: #1E1E24; font: 600 28px "Bebas Neue" }');
    expect(input.html).toBe('<p style="color: rgba(255, 138, 174, 0.5)">x</p>');
  });
});
