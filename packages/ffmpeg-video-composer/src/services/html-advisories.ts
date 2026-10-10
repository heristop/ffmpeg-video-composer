// HTML layer advisories, read render-free (the layout itself is measured on Node: html-overflow-node.ts).
// They never enter `errors`: a layer that drops a property still renders. Each says what will not show:
//   html_unsupported_markup  a tag, attribute or image the sanitiser removed;
//   html_unsupported_css     a property, value, selector or at-rule outside the supported subset;
//   html_font_unknown        a font-family neither global.fonts nor the registry knows (the default family is used);
//   html_missing_field       a {{ placeholder }} no field, variable or form field fills;
//   font_unused              a global.fonts family no layer selects (template-fonts-validation.ts).

import { defaultHtmlFamily } from '@/core/html/html-fonts';
import { prepareHtmlLayer } from '@/core/html/html-layer';
import { declaredFontFaces, templateFontSpecs, type CustomFontFace } from '@/core/html/template-fonts';
import { resolveThemeDescriptor } from '@/core/theme/resolve';
import type { MotionWarning } from './motion-lint';
import { htmlInputs, type HtmlInputUse } from './html-validation';

type Bag = Record<string, unknown>;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

function bag(value: unknown): Bag {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
}

function warn(path: string, code: string, message: string, hint: string): MotionWarning {
  return { path, code, message, severity: 'warn', hint };
}

// Names a render fills at compile time: global.variables and the form sections' fields. Declared
// `global.fields` are resolved before the advisories run.
function fillableNames(template: Bag): Set<string> {
  const variables = Object.keys(bag(bag(template.global).variables));
  const sections = Array.isArray(template.sections) ? (template.sections as unknown[]).map(bag) : [];
  const formFields = sections
    .filter((section) => section.type === 'form')
    .flatMap((section) =>
      Array.isArray(bag(section.options).fields) ? (bag(section.options).fields as unknown[]) : []
    )
    .map((field) => bag(field).name)
    .filter((name): name is string => typeof name === 'string');

  return new Set([...variables, ...formFields]);
}

function missingFields(use: HtmlInputUse, html: string, fillable: Set<string>): MotionWarning[] {
  const missing = [...new Set([...html.matchAll(PLACEHOLDER)].map((match) => match[1]))].filter(
    (name) => !fillable.has(name)
  );

  return missing.map((name) =>
    warn(
      `${use.path}.html`,
      'html_missing_field',
      `html layer: {{ ${name} }} has no value, it would show as written`,
      `Declare "${name}" in global.fields (or global.variables, or a form section's fields).`
    )
  );
}

function layerWarnings(
  use: HtmlInputUse,
  family: string,
  fillable: Set<string>,
  custom: readonly CustomFontFace[]
): MotionWarning[] {
  const html = typeof use.input.html === 'string' ? use.input.html : '';
  const css = typeof use.input.css === 'string' ? use.input.css : '';
  const width = typeof use.input.width === 'number' ? use.input.width : 1;
  const height = typeof use.input.height === 'number' ? use.input.height : 1;
  const prepared = prepareHtmlLayer({ html, css, width, height }, family, custom);
  const dropped = prepared.findings.map((finding) =>
    warn(
      `${use.path}.${finding.source}`,
      finding.code,
      `html layer: ${finding.message}`,
      'See the supported HTML and CSS subset (docs/template-configuration.md#html-layers).'
    )
  );
  const fonts = prepared.unknownFonts.map((name) =>
    warn(
      `${use.path}.${css.includes(name) ? 'css' : 'html'}`,
      'html_font_unknown',
      `html layer: font "${name}" is neither declared in global.fonts nor in the font registry, ${family} is used instead`,
      'Declare the face in global.fonts ({ family, src: "fonts/Brand.ttf" }), or use a bundled family (Rubik, ' +
        'Oswald, Bebas Neue, Playfair Display…) or a $font.* theme token.'
    )
  );

  return [...dropped, ...fonts, ...missingFields(use, html, fillable)];
}

/** Every HTML layer advisory of a (field-resolved) descriptor. */
export function htmlAdvisories(template: unknown): MotionWarning[] {
  const declared = templateFontSpecs(bag(template).global);

  if (htmlInputs(template).length === 0 && declared.length === 0) return [];

  const themed = bag(resolveThemeDescriptor(bag(template)));
  const family = defaultHtmlFamily(themed.global);
  const fillable = fillableNames(themed);
  const custom = declaredFontFaces(declared);

  return [
    ...htmlInputs(themed).flatMap((use) => layerWarnings(use, family, fillable, custom)),
    ...templateFontAdvisories(themed, family),
  ];
}

/** font_unused: each declared family no HTML layer of the (theme-resolved) descriptor selects. */
function templateFontAdvisories(template: unknown, defaultFamily: string): MotionWarning[] {
  const specs = templateFontSpecs(bag(template).global);

  if (specs.length === 0) return [];

  const custom = declaredFontFaces(specs);
  const used = new Set(
    htmlInputs(template).flatMap(({ input }) => {
      const layer = prepareHtmlLayer(
        {
          html: typeof input.html === 'string' ? input.html : '',
          css: typeof input.css === 'string' ? input.css : '',
          width: 1,
          height: 1,
        },
        defaultFamily,
        custom
      );

      return layer.faces.map((face) => face.family);
    })
  );
  const reported = new Set<string>();

  return specs.flatMap((spec, index): MotionWarning[] => {
    if (used.has(spec.family) || reported.has(spec.family)) return [];

    reported.add(spec.family);

    return [
      {
        path: `global.fonts[${index}]`,
        code: 'font_unused',
        severity: 'warn',
        message: `global.fonts: "${spec.family}" is declared but no HTML layer selects it`,
        hint:
          `Name it in an HTML layer's css (font-family: "${spec.family}"), or remove the entry. global.fonts reaches ` +
          'HTML layers only: drawn text (drawtext, kinetic, captions) keeps the font registry.',
      },
    ];
  });
}
