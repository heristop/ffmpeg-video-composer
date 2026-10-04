import { describe, it, expect } from 'vitest';
import type { EditorCaption, LowerThird, TitleCard } from '../templateEditorModel';
import { refVideoHeight } from '../overlayGeometry';
import { titleCardPreview } from './titleCardPreview';
import { lowerThirdPreview } from './lowerThirdPreview';
import { captionPreview } from './captionPreview';
import { sugarToOverlays } from './sugarToOverlays';

// The conversion lays each sugar line out at the overlay system's reference height, so a detached
// overlay previews (and renders) where the sugar block drew it.
const REF_H = refVideoHeight('landscape'); // 1080
const REF_W = (REF_H * 1280) / 720; // landscape reference width, same aspect as the engine frame

const card: TitleCard = {
  kicker: { en: 'Introducing' },
  headline: { en: 'Your headline here' },
  subtitle: { en: 'A short supporting line' },
  accent: '#7C83FD',
  reveal: { type: 'rise' },
};

describe('sugarToOverlays — titleCard', () => {
  it('returns one overlay per authored line, at the preview geometry', () => {
    const overlays = sugarToOverlays('titleCard', card, 'landscape');
    const preview = titleCardPreview(card, REF_H, 'landscape');

    if (!preview) throw new Error('expected a preview');
    expect(overlays).toHaveLength(3);

    const headline = overlays[1];
    const previewHeadline = preview.lines[1];

    expect(headline.text).toBe('Your headline here');
    expect(headline.fontsize).toBe(Math.round(previewHeadline.fontPx));
    expect(headline.fontcolor).toBe('#ffffff');
    expect(headline.font).toBe('anton');
    expect(headline.box).toBe(false);
    // Vertical centre of the drawn line, as a [0,1] fraction of the reference frame.
    if (previewHeadline.y.edge !== 'top') throw new Error('expected a top-anchored line');
    expect(headline.y).toBeCloseTo((previewHeadline.y.px + previewHeadline.fontPx / 2) / REF_H, 3);
    // Left-aligned: the estimated text centre sits right of the engine margin.
    if (previewHeadline.x.side !== 'left') throw new Error('expected a left-anchored line');
    expect(headline.x).toBeGreaterThan(previewHeadline.x.px / REF_W);
    expect(headline.x).toBeLessThan(1);
  });

  it('tints the kicker with the accent and carries the reveal', () => {
    const overlays = sugarToOverlays('titleCard', card, 'landscape');

    expect(overlays[0].fontcolor).toBe('#7C83FD');
    expect(overlays[0].reveal).toEqual({ type: 'rise', delay: 0.3 });
  });

  it('preserves line stagger, the default reveal and blank-line indices when detached', () => {
    const detached = sugarToOverlays('titleCard', { ...card, kicker: { en: ' ' }, stagger: 0.07 }, 'landscape');
    expect(detached.map((overlay) => overlay.reveal)).toEqual([
      { type: 'rise', delay: 0.3 },
      { type: 'rise', delay: 0.37 },
    ]);
    const defaults = sugarToOverlays('titleCard', { ...card, reveal: undefined }, 'landscape');
    expect(defaults.map((overlay) => overlay.reveal)).toEqual([
      { type: 'rise', delay: 0.3 },
      { type: 'rise', delay: 0.45 },
      { type: 'rise', delay: 0.6 },
    ]);
    const simultaneous = sugarToOverlays(
      'titleCard',
      { ...card, stagger: 0, reveal: { type: 'fade', delay: 1, easing: 'ease-out' } },
      'landscape'
    );
    expect(simultaneous.map((overlay) => overlay.reveal)).toEqual(
      Array(3).fill({ type: 'fade', delay: 1, easing: 'ease-out' })
    );
  });

  it('carries the text effect onto each detached line, except the effect-free badge', () => {
    const effect = { shadow: true as const };
    const overlays = sugarToOverlays('titleCard', { ...card, effect }, 'landscape');

    expect(overlays.map((o) => o.effect)).toEqual([effect, effect, effect]);

    const third = sugarToOverlays('lowerThird', { title: { en: 'Jane' }, badge: { en: '€29' }, effect }, 'landscape');
    expect(third[0].effect).toEqual(effect);
    expect(third.at(-1)?.effect).toBeUndefined(); // badge — the engine draws it without the effect
  });

  it('centers lines at x 0.5 for a centered card', () => {
    const overlays = sugarToOverlays('titleCard', { ...card, align: 'center' }, 'landscape');

    expect(overlays.map((o) => o.x)).toEqual([0.5, 0.5, 0.5]);
  });

  it('returns [] for an absent or textless card', () => {
    expect(sugarToOverlays('titleCard', undefined, 'landscape')).toEqual([]);
    expect(sugarToOverlays('titleCard', { accent: '#fff' }, 'landscape')).toEqual([]);
  });
});

describe('sugarToOverlays — lowerThird', () => {
  const third: LowerThird = {
    title: { en: 'Jane Doe' },
    subtitle: { en: 'Happy customer' },
    accent: '#FDE047',
    badge: { en: '€29' },
  };

  it('converts title, subtitle and badge with the badge pill as a text box', () => {
    const overlays = sugarToOverlays('lowerThird', third, 'landscape');
    const preview = lowerThirdPreview(third, REF_H, 'landscape');

    if (!preview) throw new Error('expected a preview');
    expect(overlays.map((o) => o.text)).toEqual(['Jane Doe', 'Happy customer', '€29']);

    const badge = overlays[2];

    expect(badge.box).toBe(true);
    expect(badge.boxcolor).toBe('#FDE047');
    expect(badge.boxOpacity).toBe(1);
    expect(badge.fontcolor).toBe('#0a0f14');
    // Right-aligned: the badge centre sits left of the right margin.
    expect(badge.x).toBeLessThan(1);
    expect(badge.x).toBeGreaterThan(0.5);

    // The title lands inside the bottom band region.
    const title = overlays[0];
    expect(title.y).toBeGreaterThan(0.8);
    expect(title.y).toBeLessThan(1);
  });

  it('returns [] when empty', () => {
    expect(sugarToOverlays('lowerThird', undefined, 'landscape')).toEqual([]);
    expect(sugarToOverlays('lowerThird', { boxOpacity: 0.5 }, 'landscape')).toEqual([]);
  });
});

describe('sugarToOverlays — caption', () => {
  it('converts the caption with its preset box and centre anchors', () => {
    const caption: EditorCaption = { text: 'Hello there' };
    const overlays = sugarToOverlays('caption', caption, 'landscape');
    const preview = captionPreview(caption, REF_H, 'landscape');

    if (!preview) throw new Error('expected a preview');
    expect(overlays).toHaveLength(1);

    const overlay = overlays[0];
    expect(overlay.text).toBe('Hello there');
    expect(overlay.x).toBe(0.5); // centered
    expect(overlay.fontsize).toBe(Math.round(preview.fontPx));
    expect(overlay.font).toBe('oswald');
    expect(overlay.box).toBe(true);
    expect(overlay.boxcolor).toBe('#141416');
    expect(overlay.boxOpacity).toBe(0.8);
    // lower-third position → near the bottom of the frame.
    expect(overlay.y).toBeGreaterThan(0.8);
    expect(overlay.y).toBeLessThan(1);
  });

  it('maps a center position to the frame middle', () => {
    const overlays = sugarToOverlays('caption', { text: 'Hi', position: 'center' }, 'landscape');

    expect(overlays[0].y).toBe(0.5);
  });

  it('returns [] for blank text', () => {
    expect(sugarToOverlays('caption', { text: '  ' }, 'landscape')).toEqual([]);
    expect(sugarToOverlays('caption', undefined, 'landscape')).toEqual([]);
  });
});

describe('sugarToOverlays — portrait reference frame', () => {
  it('scales font sizes against the portrait 1920-line reference', () => {
    const overlays = sugarToOverlays('titleCard', card, 'portrait');
    const preview = titleCardPreview(card, refVideoHeight('portrait'), 'portrait');

    if (!preview) throw new Error('expected a preview');
    expect(overlays[1].fontsize).toBe(Math.round(preview.lines[1].fontPx));
  });
});
