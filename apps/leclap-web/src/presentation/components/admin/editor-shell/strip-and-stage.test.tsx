// @vitest-environment node
// The scene strip's audio lane, the single-row panel header and the safe-area switch, rendered in en so
// their copy keys are guarded.
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import type { ReactNode } from 'react';
import admin from '@/i18n/locales/en/admin.json';
import { MUSIC_LIBRARY } from '@/data/mediaCatalog';
import { MusicLane } from './music-lane';
import { PanelFrame } from './panel-frame';
import { formatLabel, SafeGuidesToggle } from './safe-guides';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const render = (node: ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
const noop = () => {};
const [a, b, c] = MUSIC_LIBRARY;

describe('MusicLane', () => {
  it('names the default track and counts the other offered tracks', () => {
    const html = render(
      <MusicLane
        section={{ kind: 'music', allowed: [b.id, a.id, c.id], allowUpload: false }}
        index={2}
        selected
        canDelete
        onSelect={noop}
        onDelete={noop}
      />
    );

    expect(html).toContain(b.title);
    expect(html).toContain('+2 offered');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(`title="${admin.shell.deleteSceneTooltip}"`);
  });

  it('marks the stand-in when nothing is ticked', () => {
    const html = render(
      <MusicLane
        section={{ kind: 'music', allowed: [], allowUpload: true }}
        index={0}
        selected={false}
        canDelete
        onSelect={noop}
        onDelete={noop}
      />
    );

    expect(html).toContain(admin.monitor.musicStandIn);
    expect(html).not.toContain(admin.shell.deleteSceneTooltip);
  });
});

describe('PanelFrame', () => {
  it('puts the title and its meta on one row, with no label above the title', () => {
    const html = render(
      <PanelFrame title="Music selection" meta="Scene 3 of 3">
        body
      </PanelFrame>
    );

    expect(html).toMatch(/<header[^>]*><h2[^>]*>Music selection<\/h2><span[^>]*>Scene 3 of 3<\/span><\/header>/);
    expect(admin.shell.sceneOf).toBe('Scene {{index}} of {{count}}');
  });
});

describe('safe areas', () => {
  it('switches with a pressed state and explains itself', () => {
    const html = render(<SafeGuidesToggle />);

    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(admin.shell.safeGuides);
    expect(html).toContain(admin.shell.safeGuidesTooltip);
  });

  it('labels the frame format', () => {
    expect(formatLabel('portrait', '30 fps')).toBe('9:16 · 30 fps');
    expect(admin.shell.playTooltip).toContain('Space');
    expect(admin.shell.duplicateSceneTooltip).toContain('⌘D');
  });
});
