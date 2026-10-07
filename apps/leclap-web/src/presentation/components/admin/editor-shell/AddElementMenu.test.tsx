// @vitest-environment node
// Renders AddElementMenu to static markup (no jsdom here) for the trigger/empty contract, and
// unit-tests the pure `addableKinds` gating directly so option visibility is covered without an
// open popover under SSR.
import { beforeAll, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import { newSection } from '../templateEditorModel';
import { AddElementMenu, addableKinds } from './AddElementMenu';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const noop = () => {};

const render = (kind: Parameters<typeof newSection>[0]) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AddElementMenu section={newSection(kind)} onAdd={noop} />
    </I18nextProvider>
  );

describe('addableKinds', () => {
  it('orders video kinds (sugar singletons trail while absent)', () => {
    expect(addableKinds(newSection('video'))).toEqual([
      'text',
      'image',
      'shapeRect',
      'shapeEllipse',
      'effect',
      'animation',
      'caption',
      'lowerThird',
    ]);
  });

  it('orders color kinds (sugar singletons trail while absent)', () => {
    expect(addableKinds(newSection('color'))).toEqual([
      'layer',
      'text',
      'image',
      'shapeRect',
      'shapeEllipse',
      'effect',
      'animation',
      'caption',
      'titleCard',
    ]);
  });

  it('orders image kinds (sugar singletons trail while absent)', () => {
    expect(addableKinds(newSection('image'))).toEqual([
      'text',
      'image',
      'shapeRect',
      'shapeEllipse',
      'effect',
      'animation',
      'caption',
    ]);
  });

  it('returns nothing for music', () => {
    expect(addableKinds(newSection('music'))).toEqual([]);
  });

  it('returns nothing for form', () => {
    expect(addableKinds(newSection('form'))).toEqual([]);
  });
});

describe('AddElementMenu', () => {
  it('renders the add trigger for a video section', () => {
    const html = render('video');

    expect(html).toContain(`aria-label="${admin.element.add}"`);
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('renders nothing for a music section', () => {
    expect(render('music')).toBe('');
  });

  it('renders nothing for a form section', () => {
    expect(render('form')).toBe('');
  });
});
