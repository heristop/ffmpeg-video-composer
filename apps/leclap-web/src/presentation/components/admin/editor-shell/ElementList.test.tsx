// @vitest-environment node
// Renders ElementList to static markup (no jsdom in the web app), asserting the a11y contract for the
// cross-kind element list: one selectable row per descriptor with aria-pressed mirroring the active
// ref, per-row delete + move-up/move-down controls, and the empty state.
import { beforeAll, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import type { ElementDescriptor } from './sectionElements';
import { ElementList } from './ElementList';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const elements: ElementDescriptor[] = [
  { ref: { kind: 'layer', index: 0 }, kind: 'layer', labelKey: 'element.layer', labelParams: { n: 1 } },
  { ref: { kind: 'text', index: 0 }, kind: 'text', labelKey: 'element.text', labelParams: { n: 1 } },
  { ref: { kind: 'animation', index: 0 }, kind: 'animation', labelKey: 'element.animation', labelParams: { n: 1 } },
];

const noop = () => {};

const render = (els: ElementDescriptor[], active: ElementDescriptor['ref'] | null) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ElementList elements={els} activeRef={active} onSelect={noop} onDelete={noop} onMove={noop} />
    </I18nextProvider>
  );

describe('ElementList', () => {
  it('states the kind of an effect row and an animation-file row', () => {
    const html = render(
      [
        {
          ref: { kind: 'animation', index: 0 },
          kind: 'animation',
          labelKey: 'element.animation',
          family: 'file',
          previewText: 'confetti.apng',
        },
        {
          ref: { kind: 'effect', index: 0 },
          kind: 'effect',
          labelKey: 'element.effect',
          family: 'effect',
          previewKey: 'animation.library.sheen',
        },
      ],
      null
    );

    expect(html).toContain('aria-label="Animation file: confetti.apng"');
    expect(html).toContain('aria-label="Effect: Sheen"');
    expect(html).toContain('>Animation file<');
    expect(html).toContain('>Effect<');
    // Each family wears its own tone: lavender for effects, rose for files.
    expect(html).toContain('bg-brand-500/15');
    expect(html).toContain('bg-secondary-500/15');
  });

  it('renders one row per descriptor with the active row pressed', () => {
    const html = render(elements, { kind: 'text', index: 0 });

    expect(html.match(/aria-pressed="/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
  });

  it('exposes a delete control on each row', () => {
    const html = render(elements, null);

    expect(html.match(new RegExp(`aria-label="${admin.element.delete}"`, 'g'))).toHaveLength(3);
  });

  // Reorder is scoped per kind (each kind lives in its own array), so the move arrows reflect an
  // element's position WITHIN its kind, not the flattened list.
  const ups = (html: string) => [
    ...html.matchAll(new RegExp(`<button[^>]*aria-label="${admin.element.moveUp}"[^>]*>`, 'g')),
  ];
  const downs = (html: string) => [
    ...html.matchAll(new RegExp(`<button[^>]*aria-label="${admin.element.moveDown}"[^>]*>`, 'g')),
  ];

  it('disables move-up on the first and move-down on the last element of a kind', () => {
    const texts: ElementDescriptor[] = [0, 1, 2].map((index) => ({
      ref: { kind: 'text', index },
      kind: 'text',
      labelKey: 'element.text',
      labelParams: { n: index + 1 },
    }));
    const html = render(texts, null);
    // React SSR renders the whole opening tag; a disabled button carries a boolean `disabled=""`.
    const upMatches = ups(html);
    const downMatches = downs(html);

    expect(upMatches[0][0]).toContain('disabled=""'); // first text → can't move up
    expect(upMatches[1][0]).not.toContain('disabled=""'); // middle → both enabled
    expect(downMatches[1][0]).not.toContain('disabled=""');
    expect(downMatches[2][0]).toContain('disabled=""'); // last text → can't move down
  });

  it('disables both arrows for an element that is alone in its kind (no cross-kind reorder)', () => {
    // The mixed list has one element per kind, so none can move within its kind.
    const html = render(elements, null);

    expect(ups(html).every((m) => m[0].includes('disabled=""'))).toBe(true);
    expect(downs(html).every((m) => m[0].includes('disabled=""'))).toBe(true);
  });

  it('renders the empty state for an empty list', () => {
    const html = render([], null);

    expect(html).toContain(admin.element.empty);
  });
});
