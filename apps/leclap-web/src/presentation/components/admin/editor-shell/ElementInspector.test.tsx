// @vitest-environment node
// Renders ElementInspector to static markup (no jsdom here) and asserts each kind dispatches to its
// reused control by a distinctive bit of that control's output.
import { beforeAll, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import {
  newSection,
  newOverlay,
  makeTemplateId,
  type EditorSection,
  type ImageOverlay,
  type AnimationOverlay,
} from '../templateEditorModel';
import { newExtraLayer } from '../editor/layerGeometry';
import type { ElementRef } from './useSectionSelection';
import { ElementInspector } from './ElementInspector';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const noop = () => {};

const render = (
  section: EditorSection,
  activeRef: ElementRef | null,
  slotMode?: { index: number; mode: 'effect' | 'file' }
) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ElementInspector
        section={section}
        activeRef={activeRef}
        variables={['name']}
        orientation="landscape"
        onPatchSection={noop}
        onSelectElement={noop}
        slotMode={slotMode}
      />
    </I18nextProvider>
  );

const colorWithLayer = (): EditorSection => ({
  ...(newSection('color') as Extract<EditorSection, { kind: 'color' }>),
  layers: [newExtraLayer(), newExtraLayer()],
  overlays: [newOverlay()],
});

const videoWithImage = (): EditorSection => {
  const image: ImageOverlay = { id: makeTemplateId(), choice: { source: 'url', url: '' }, position: '10:20' };

  return { ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>), images: [image] };
};

const videoWithAnimation = (url = ''): EditorSection => {
  const animation: AnimationOverlay = { id: makeTemplateId(), url };

  return { ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>), animations: [animation] };
};

describe('ElementInspector', () => {
  it('renders the select hint when nothing is selected', () => {
    const html = render(newSection('video'), null);

    expect(html).toContain(admin.element.selectHint);
  });

  it('renders the select hint when the referenced element is out of range', () => {
    const html = render(newSection('video'), { kind: 'text', index: 4 });

    expect(html).toContain(admin.element.selectHint);
  });

  it('dispatches a text ref to SelectedControls', () => {
    const section = { ...(newSection('video') as Extract<EditorSection, { kind: 'video' }>), overlays: [newOverlay()] };
    const html = render(section, { kind: 'text', index: 0 });

    expect(html).toContain(`aria-label="${admin.overlay.font}"`);
    // The finishing controls sit under the two collapsed disclosures with state summaries
    // (static markup HTML-escapes the ampersand in the group labels).
    expect(html).toContain(admin.overlay.styleGroup.replace('&', '&amp;'));
    expect(html).toContain(admin.overlay.motionGroup.replace('&', '&amp;'));
    expect(html).toContain(admin.summaryChip.none);
  });

  it('dispatches a layer ref to LayerRow', () => {
    const html = render(colorWithLayer(), { kind: 'layer', index: 1 });

    expect(html).toContain(`aria-label="${admin.layer.moveUp}"`);
    expect(html).toContain(`aria-label="${admin.layer.remove}"`);
  });

  it('dispatches an image ref to PlacementControls', () => {
    const html = render(videoWithImage(), { kind: 'image', index: 0 });

    // The numeric fields live inside the collapsed Placement disclosure; its summary carries the value.
    expect(html).toContain(admin.animation.placementGroup);
    expect(html).toContain('10:20');
  });

  it('opens an empty animation slot on the effects side of the picker', () => {
    const html = render(videoWithAnimation(), { kind: 'animation', index: 0 });

    expect(html).toContain(`aria-label="${admin.animation.kind.switch}"`);
    expect(html).toContain(admin.animation.kind.effect.subtitle);
    expect(html).not.toContain(admin.media.tab.library);
  });

  it('opens a slot added as an animation file on the files side', () => {
    const html = render(videoWithAnimation(), { kind: 'animation', index: 0 }, { index: 0, mode: 'file' });

    expect(html).toContain(admin.animation.kind.file.subtitle);
    expect(html).toContain(admin.media.tab.library);
  });

  it('heads an animation-file element with its name and kind, and offers its engine effect', () => {
    const html = render(videoWithAnimation('/assets/animations/confetti.apng'), { kind: 'animation', index: 0 });

    expect(html).toContain('confetti.apng');
    expect(html).toContain(`>${admin.animation.kind.file.name}<`);
    expect(html).toContain('· APNG');
    expect(html).toContain(admin.animation.picker.upgrade);
  });
});
