import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clusterKey, emojiClusters, hasEmoji, splitEmoji } from '@/core/emoji-clusters';
import { MAX_EMOJI_OVERLAYS, emojiAssetFile, emojiAssetKey, emojiMode } from '@/core/emoji-assets';
import { TemplateValidator } from '@/services/TemplateValidator';
import { EMOJI_ASSET_KEYS } from '@/core/emoji-manifest.generated';
import { fontCovers } from '@/core/font-coverage';
import { measureBundled } from '@/core/kinetic/layout';
import { layoutEmojiText, GAP_CHAR } from '@/editor/emoji/emoji-text';
import { emojiAlphaFilters, overlayCoordinate, toOverlayExpr } from '@/editor/emoji/emoji-expr';

const here = path.dirname(fileURLToPath(import.meta.url));
const emojiDir = path.resolve(here, '../../leclap-creative-kit/src/library/emoji');

describe('emoji cluster splitting', () => {
  it('keeps ZWJ sequences, skin tones, VS16, flags, keycaps and tag flags whole', () => {
    const clusters = ['👨‍👩‍👧', '👍🏽', '❤️', '🇫🇷', '1️⃣', '#⃣', '🏳️‍🌈', '🤷🏽‍♀️', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '❤️‍🔥'];

    expect(emojiClusters(`a${clusters.join('b')}c`)).toEqual(clusters);
  });

  it('splits text into plain runs and clusters that join back to the input', () => {
    const text = 'Hot 🔥🔥 deal 👍🏽!';
    const segments = splitEmoji(text);

    expect(segments).toEqual([
      { text: 'Hot ', emoji: false },
      { text: '🔥', emoji: true },
      { text: '🔥', emoji: true },
      { text: ' deal ', emoji: false },
      { text: '👍🏽', emoji: true },
      { text: '!', emoji: false },
    ]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('leaves digits, # and * without a keycap mark as text', () => {
    expect(hasEmoji('Call #1 * 2')).toBe(false);
    expect(hasEmoji('plain ASCII')).toBe(false);
  });

  it('treats a bare text-default pictograph as text when the font draws it (or it is ©/®/™)', () => {
    expect(emojiClusters('© 2026 ™')).toEqual([]);
    expect(emojiClusters('love ❤ it')).toEqual(['❤']);
    expect(emojiClusters('love ❤ it', () => true)).toEqual([]);
    expect(emojiClusters('©️ with VS16')).toEqual(['©️']);
    expect(emojiClusters('☀︎ text style')).toEqual([]);
  });

  it('uses bundled font coverage to decide text-default pictographs', () => {
    const covered = (point: number) => fontCovers('Rubik.ttf', point);

    expect(emojiClusters('→ next', covered)).toEqual([]);
  });

  it('names clusters by lowercase hex code points joined by "-"', () => {
    expect(clusterKey('👍🏽')).toBe('1f44d-1f3fd');
    expect(clusterKey('1️⃣')).toBe('31-fe0f-20e3');
  });
});

describe('bundled emoji lookup', () => {
  it('ships every manifest entry as a 72px PNG in the creative kit', () => {
    const files = fs.readdirSync(emojiDir).filter((file) => file.endsWith('.png'));

    expect(files.sort()).toEqual(EMOJI_ASSET_KEYS.map(emojiAssetFile).sort());
    expect(EMOJI_ASSET_KEYS.length).toBeGreaterThanOrEqual(150);

    const bytes = files.reduce((total, file) => total + fs.statSync(path.join(emojiDir, file)).size, 0);

    expect(bytes).toBeLessThan(1024 * 1024);
  });

  it('falls back exact → without FE0F → without skin tone → base', () => {
    expect(emojiAssetKey('👍🏽')).toBe('1f44d-1f3fd');
    expect(emojiAssetKey('❤️')).toBe('2764');
    expect(emojiAssetKey('❤')).toBe('2764');
    expect(emojiAssetKey('1️⃣')).toBe('31-20e3');
    expect(emojiAssetKey('🏳‍🌈')).toBe('1f3f3-fe0f-200d-1f308');
    expect(emojiAssetKey('🔥🏽')).toBe('1f525');
    expect(emojiAssetKey('🤷🏾‍♀️')).toBe('1f937-200d-2640-fe0f');
    expect(emojiAssetKey('👋🏼')).toBe('1f44b');
    expect(emojiAssetKey('🧌')).toBeNull();
    expect(emojiAssetKey('🇿🇼')).toBeNull();
  });

  it('reads global.emoji, defaulting to image', () => {
    expect(emojiMode(undefined)).toBe('image');
    expect(emojiMode({ emoji: 'strip' })).toBe('strip');
    expect(emojiMode({ emoji: 'error' })).toBe('error');
    expect(emojiMode({ emoji: 'bogus' })).toBe('image');
  });
});

describe('emoji text layout', () => {
  const options = { font: 'Rubik.ttf', fontSize: 40, strip: false };

  it('replaces each emoji with an NBSP gap one emoji wide and records its offset', () => {
    const layout = layoutEmojiText('Hi 🔥', { ...options, budget: { remaining: 24 } });
    const prefix = measureBundled('Rubik.ttf', 'Hi ', 40) as number;
    const gap = layout.text.slice(3);

    expect(layout.size).toBe(44);
    expect(gap).toBe(GAP_CHAR.repeat(gap.length));
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0].key).toBe('1f525');
    expect(layout.slots[0].dx).toBeGreaterThan(prefix - 2);
    expect(layout.slots[0].dx).toBeLessThan(prefix + 2);
  });

  it('tracks lines and strips clusters without an image or past the budget', () => {
    const budget = { remaining: 1 };
    const layout = layoutEmojiText('🔥 one\n🧌 two 🚀', { ...options, budget });

    expect(layout.slots.map((slot) => [slot.key, slot.line])).toEqual([['1f525', 0]]);
    expect(layout.missing).toEqual(['🧌']);
    expect(layout.capped).toBe(1);
    expect(layout.text.split('\n')[1]).toBe(' two ');
    expect(budget.remaining).toBe(0);
  });

  it('removes every emoji in strip mode', () => {
    const layout = layoutEmojiText('A 🔥 B', { ...options, strip: true, budget: { remaining: 24 } });

    expect(layout.text).toBe('A  B');
    expect(layout.slots).toEqual([]);
    expect(layout.stripped).toBe(1);
  });

  it('counts emoji at the image width in kinetic measurement', () => {
    expect(measureBundled('Rubik.ttf', '🔥', 100)).toBeCloseTo(110);
  });
});

describe('emoji overlay expressions', () => {
  const metrics = {
    w: 1280,
    h: 720,
    text_w: 200,
    text_h: 48,
    line_h: 48,
    max_glyph_a: 36,
    max_glyph_d: -10,
    max_glyph_h: 46,
    max_glyph_w: 40,
  };

  it('folds static positions to pixels', () => {
    expect(overlayCoordinate('(w-text_w)/2', 10, metrics)).toEqual({ value: '550', moving: false });
    expect(overlayCoordinate("'(h-text_h)-110'", 0, metrics)).toEqual({ value: '562', moving: false });
    expect(overlayCoordinate(undefined, 5, metrics)).toEqual({ value: '5', moving: false });
  });

  it('rewrites time expressions into overlay terms', () => {
    expect(toOverlayExpr("'(w-text_w)/2+if(lt(t,1),t*10,10)'", metrics)).toBe('(W-(200))/2+if(lt(t,1),t*10,10)');
    expect(overlayCoordinate('100+t*5', 4, metrics)).toEqual({ value: '(100+t*5)+4', moving: true });
    expect(toOverlayExpr('x_unknown+t', metrics)).toBeNull();
  });

  it('lowers an alpha ramp to fades on the image leg', () => {
    const window = { duration: 3, fps: 30, frame: { w: 1280, h: 720 } };

    expect(emojiAlphaFilters(undefined, window)).toEqual([]);
    expect(emojiAlphaFilters('1', window)).toEqual([]);
    expect(emojiAlphaFilters('0.5', window)).toEqual(['colorchannelmixer=aa=0.5']);
    expect(emojiAlphaFilters("'if(lt(t,0.3),0,if(lt(t,0.9),(t-0.3)/0.6,1))'", window)).toEqual([
      'fade=t=in:st=0.3:d=0.6:alpha=1',
    ]);
    expect(emojiAlphaFilters('clip((2.5-t)/0.5,0,1)', window)).toEqual(['fade=t=out:st=2:d=0.5:alpha=1']);
  });
});

describe('emoji validation modes', () => {
  function captioned(text: string, global: Record<string, unknown> = {}): unknown {
    return {
      global,
      sections: [{ name: 's', type: 'video', options: { duration: 2 }, caption: { text: { en: text } } }],
    };
  }

  function codes(template: unknown): string[] {
    return new TemplateValidator()
      .getMotionWarnings(template)
      .filter((warning) => warning.code.startsWith('emoji_'))
      .map((warning) => warning.code);
  }

  it('accepts the emoji in default image mode and declares global.emoji in the schema', () => {
    const validator = new TemplateValidator();

    for (const emoji of [undefined, 'image', 'strip', 'error']) {
      const result = validator.validateTemplate(captioned('Hi 🔥', emoji ? { emoji } : {}));

      expect(result.success, String(emoji)).toBe(emoji !== 'error');
    }

    expect(validator.validateTemplate(captioned('Hi', { emoji: 'colour' })).success).toBe(false);
    expect(codes(captioned('Hi 🔥 👍🏽 🇫🇷'))).toEqual([]);
  });

  it('warns emoji_missing_asset for a cluster without a bundled image', () => {
    const [warning] = new TemplateValidator().getMotionWarnings(captioned('Troll 🧌'));

    expect(warning).toMatchObject({ code: 'emoji_missing_asset', path: 'sections[0].caption.text.en' });
    expect(warning.message).toContain('🧌');
  });

  it('warns emoji_stripped in strip mode, nothing in error mode', () => {
    expect(codes(captioned('Hi 🔥', { emoji: 'strip' }))).toEqual(['emoji_stripped']);
    expect(codes(captioned('Hi 🔥 🧌', { emoji: 'error' }))).toEqual([]);
  });

  it(`warns emoji_overlay_cap past ${MAX_EMOJI_OVERLAYS} images in a section`, () => {
    expect(codes(captioned('🔥'.repeat(MAX_EMOJI_OVERLAYS)))).toEqual([]);
    expect(codes(captioned('🔥'.repeat(MAX_EMOJI_OVERLAYS + 1)))).toEqual(['emoji_overlay_cap']);
  });
});
