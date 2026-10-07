// @vitest-environment node
// Renders the engine-effect parameter panel to static markup (no jsdom/RTL in the web app): the panel's
// controls come from the engine schema (a sheen's profile, width, tilt…), unset parameters read Auto, and
// its header states the kind (an effect: drawn by the engine, adjustable).
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import type { Graphic } from 'ffmpeg-video-composer/src/schemas/graphics.schemas.ts';
import { newSection, type EditorSection } from '../templateEditorModel';
import { FxParamPanel } from './FxParamPanel';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const noop = () => {};

const card = {
  ...newSection('color'),
  layers: [{ color: '#000000' }, { color: '#334155', x: 100, y: 100, w: 500, h: 300 }],
} as EditorSection;

const panel = (graphic: Record<string, unknown>) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <FxParamPanel graphic={graphic as Graphic} section={card} onChange={noop} onRemove={noop} />
    </I18nextProvider>
  );

describe('FxParamPanel', () => {
  it('shows the primitive, its target and a control per schema parameter', () => {
    const html = panel({ type: 'fx', effect: 'sheen', target: 'layer:1', width: 0.12 });

    expect(html).toContain('Sheen');
    expect(html).toContain('>Effect<');
    expect(html).toContain('Engine · adjustable');
    expect(html).toContain('Applies to');
    for (const label of ['Profile', 'Width', 'Tilt (°)', 'Direction', 'Bloom', 'Intensity', 'Color']) {
      expect(html).toContain(label);
    }
    // A set parameter shows its value and can go back to auto; an unset one reads Auto.
    expect(html).toContain('0.12');
    expect(html).toContain('Set Width back to auto');
    expect(html).toContain('Auto');
    expect(html).toContain('New variation');
  });

  it('offers the theme colour tokens', () => {
    const html = panel({ type: 'fx', effect: 'edge-glow', glow: '$color.accent' });

    expect(html).toContain('Glow color');
    expect(html).toContain('Accent');
    expect(html).toContain('Background');
  });

  it('builds the stroke controls of a corners graphic, without a re-roll', () => {
    const html = panel({ type: 'corners', inset: 48, trace: 'clockwise' });

    expect(html).toContain('Corner brackets');
    expect(html).toContain('Trace');
    expect(html).toContain('Exit');
    expect(html).not.toContain('New variation');
  });

  it('points a graphic it has no controls for to the JSON editor', () => {
    expect(panel({ type: 'flash', at: 1 })).toContain('JSON editor');
  });
});
