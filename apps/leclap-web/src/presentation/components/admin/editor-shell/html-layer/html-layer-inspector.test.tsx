// @vitest-environment node
// The HTML layer inspector rendered to static markup (no jsdom here): its labelled code fields, the field
// chips, the box and the preview slot, every string coming from the admin namespace in each locale.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import fr from '@/i18n/locales/fr/admin.json';
import de from '@/i18n/locales/de/admin.json';
import es from '@/i18n/locales/es/admin.json';
import itLocale from '@/i18n/locales/it/admin.json';
import { newHtmlLayer } from '../../templateEditorModel';
import { HtmlLayerInspector } from './html-layer-inspector';
import { boxFromScale } from './html-layer-canvas-item';

vi.mock('./html-layer-preview', () => ({ previewHtmlLayer: vi.fn(() => new Promise(() => {})) }));

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const ENV = {
  global: {},
  values: { city: 'Lyon' },
  fields: [
    { name: 'city', source: 'variable' as const },
    { name: 'agent', source: 'form' as const },
  ],
};

const render = (env = ENV) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <HtmlLayerInspector layer={newHtmlLayer()} env={env} onChange={() => {}} onRemove={() => {}} />
    </I18nextProvider>
  );

describe('HtmlLayerInspector', () => {
  it('labels both code fields and ties them to the advisories', () => {
    const html = render();

    expect(html).toContain(`>${admin.htmlLayer.html}</label>`);
    expect(html).toContain(`>${admin.htmlLayer.css}</label>`);
    expect(html.match(/<textarea[^>]*aria-describedby="[^"]+-findings"/g)).toHaveLength(2);
  });

  it('offers each field as a chip that inserts {{ name }}', () => {
    const html = render();

    expect(html).toContain('aria-label="Insert city"');
    expect(html).toContain('{{ agent }}');
  });

  it('says how to get fields when the template has none', () => {
    expect(render({ ...ENV, fields: [] })).toContain(admin.htmlLayer.fieldsEmpty);
  });

  it('has its box and a preview slot', () => {
    const html = render();

    expect(html).toContain(admin.htmlLayer.width);
    expect(html).toContain(admin.htmlLayer.height);
    expect(html).toContain(admin.htmlLayer.drawing);
  });

  it.each([
    ['fr', fr],
    ['de', de],
    ['es', es],
    ['it', itLocale],
  ])('is translated in %s, with every advisory', (_lng, bundle) => {
    expect(Object.keys(bundle.htmlLayer).toSorted()).toEqual(Object.keys(admin.htmlLayer).toSorted());
    expect(Object.keys(bundle.htmlLayer.advisory).toSorted()).toEqual(Object.keys(admin.htmlLayer.advisory).toSorted());
    expect(bundle.element.addHtml).toBeTruthy();
  });
});

describe('boxFromScale', () => {
  it('turns a resize into the layer box, within the bounds, and drops the scale', () => {
    const layer = { ...newHtmlLayer(), width: 400, height: 100, scale: '400:100' };

    expect(boxFromScale('512.4:2400', layer)).toEqual({ width: 512, height: 1920, scale: undefined });
    expect(boxFromScale('4:-1', layer)).toEqual({ width: 16, height: 16, scale: undefined });
  });
});
