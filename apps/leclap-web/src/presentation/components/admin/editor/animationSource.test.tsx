// @vitest-environment node
// The animation picker keeps the two kinds apart (static markup, no jsdom in the web app): a section host
// opens on a top-level "Effects | Animation files" switch, effects first; the effects side lists only the
// engine groups and their combinations, each card an "adjustable" effect; the files side lists only the
// stock files with their format, behind the Library / Upload / Url tabs; a files-only host (the whole-video
// overlays) shows the files side alone. Plus the pure helpers that name a file and its format.
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import admin from '@/i18n/locales/en/admin.json';
import { EffectLibraryPicker, SampleLibraryPicker } from './AnimationLibraryPicker';
import { AnimationSource, pickInitialMode } from './animationSource';
import { animationFileName, animationFormat } from './animationOverlay';

beforeAll(async () => {
  await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['admin'], defaultNS: 'admin', resources: { en: { admin } } });
});

const noop = () => {};

const html = (node: ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

describe('EffectLibraryPicker', () => {
  it('leads with the combinations, then the engine groups, and holds no file', () => {
    const out = html(<EffectLibraryPicker onPickEngine={noop} onPickRecipe={noop} />);
    const order = ['Effect combinations', '>Light<', '>Focus<', '>Celebrate<', '>Frames<', '>Ambient<'];
    const at = order.map((label) => out.indexOf(label));

    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(out).toContain('Add the Sheen effect (drawn by the engine, adjustable)');
    expect(out).toContain('title="Adjustable once added"');
    expect(out).toContain('/assets/animation-thumbs/sheen.webp');
    expect(out).toContain('prefers-reduced-motion: reduce');
    expect(out).not.toContain('Stock files');
    expect(out).not.toContain('Animation file:');
    expect(out).not.toContain('Animation icons');
  });
});

describe('SampleLibraryPicker', () => {
  it('lists the stock files with their format, no engine card', () => {
    const out = html(<SampleLibraryPicker onPickSample={noop} selectedUrl="/assets/animations/shine_sweep.apng" />);

    expect(out).toContain('>Stock files<');
    expect(out).toContain('Animation file: Shine sweep (APNG)');
    expect(out).toContain('>APNG<');
    expect(out).toContain('aria-pressed="true"');
    expect(out).not.toContain('>Light<');
    expect(out).not.toContain('effect (drawn by the engine');
  });
});

describe('AnimationSource', () => {
  const switchOf = (out: string) => out.includes('<div role="tablist" aria-label="Effects or animation files"');

  it('opens an empty section slot on the effects side, behind the kind switch', () => {
    const out = html(<AnimationSource value={undefined} onChange={noop} onPickEngine={noop} onPickRecipe={noop} />);

    expect(switchOf(out)).toBe(true);
    expect(out).toContain('Drawn by LeClap and tuned to this scene');
    expect(out).toContain('Engine · adjustable');
    expect(out).toContain('>Light<');
    expect(out).not.toContain('Stock files');
  });

  it('opens on the files side when asked, or when a file is already chosen', () => {
    const asked = html(<AnimationSource value={undefined} onChange={noop} onPickEngine={noop} initialMode="file" />);
    const chosen = html(
      <AnimationSource value={{ url: '/assets/animations/confetti.apng' }} onChange={noop} onPickEngine={noop} />
    );

    for (const out of [asked, chosen]) {
      expect(switchOf(out)).toBe(true);
      expect(out).toContain('A clip played as-is on top of the scene');
      expect(out).toContain('aria-label="Animation file source"');
      expect(out).not.toContain('>Light<');
    }
    expect(chosen).toContain('File · APNG');
  });

  it('shows only the files side, without the switch, where the host takes files only', () => {
    const out = html(<AnimationSource value={undefined} onChange={noop} />);

    expect(switchOf(out)).toBe(false);
    expect(out).toContain('>Animation files<');
    expect(out).toContain('Stock files');
    expect(out).not.toContain('>Light<');
  });
});

describe('pickInitialMode', () => {
  it('reopens a chosen file on the files side, an empty slot where asked (effects by default)', () => {
    expect(pickInitialMode({ url: 'a.apng' }, 'effect')).toBe('file');
    expect(pickInitialMode({ url: '' }, 'file')).toBe('file');
    expect(pickInitialMode()).toBe('effect');
  });
});

describe('animation file helpers', () => {
  it('reads the format from a data: mime type or the extension', () => {
    expect(animationFormat('data:image/apng;base64,AAA')).toBe('APNG');
    expect(animationFormat('data:video/webm;base64,AAA')).toBe('WebM');
    expect(animationFormat('https://cdn.example.com/burst.GIF?v=2')).toBe('GIF');
    expect(animationFormat('/assets/animations/confetti.apng')).toBe('APNG');
    expect(animationFormat('https://cdn.example.com/a.webp#x')).toBe('WebP');
    expect(animationFormat('https://cdn.example.com/stream')).toBeUndefined();
  });

  it('names a file by its basename, an upload by its own filename', () => {
    expect(animationFileName({ url: '/assets/animations/confetti.apng', label: 'Confetti' })).toBe('confetti.apng');
    expect(animationFileName({ url: 'https://x.dev/my%20burst.webm?v=1' })).toBe('my burst.webm');
    expect(animationFileName({ url: 'data:image/apng;base64,AAA', label: 'logo.apng' })).toBe('logo.apng');
  });
});
