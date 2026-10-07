import { describe, it, expect } from 'vitest';
import {
  PLATFORMS,
  PLATFORM_ALIASES,
  PLATFORM_IDS,
  PLATFORM_NAMES,
  effectiveOrientation,
  platformCatalog,
  platformLoudnorm,
  resolvePlatform,
} from '@/core/platforms';
import { GlobalConfigSchema } from '@/schemas/global.schemas';
import { resolveBuildVideoConfig } from '@/director/prepare-build';
import { captionToFilters } from '@/editor/presets/captions';
import { collectGeometryWarnings } from '@/services/geometry';
import { motionCatalog } from '@/core/motion';
import type { TemplateDescriptor } from '@/schemas/template.schemas';

function template(global: Record<string, unknown>, sections: Record<string, unknown>[]): TemplateDescriptor {
  return { global, sections } as unknown as TemplateDescriptor;
}

function card(caption?: Record<string, unknown>, duration = 4): Record<string, unknown> {
  return { type: 'color_background', name: 'a', options: { duration, backgroundColor: '#141416' }, caption };
}

describe('platform table', () => {
  it('keeps every safe-zone fraction in [0, 0.5) and every profile complete', () => {
    for (const id of PLATFORM_IDS) {
      const platform = PLATFORMS[id];

      for (const fraction of Object.values(platform.safe)) {
        expect(fraction).toBeGreaterThanOrEqual(0);
        expect(fraction).toBeLessThan(0.5);
      }

      expect(platform.maxDuration).toBeGreaterThan(0);
      expect(platform.loudness.lufs).toBeLessThan(0);
      expect(platform.loudness.truePeak).toBeLessThanOrEqual(0);
      expect(Object.keys(platform.ui).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    }
  });

  it('resolves every alias to a canonical profile', () => {
    for (const [alias, id] of Object.entries(PLATFORM_ALIASES)) {
      expect(resolvePlatform(alias)?.id).toBe(id);
    }

    expect(resolvePlatform('ig')?.title).toBe('Instagram Reels');
    expect(resolvePlatform('twitter')?.maxDuration).toBe(140);
    expect(resolvePlatform('youtube-shorts')?.id).toBe('shorts');
  });

  it('rejects unknown names, including inherited object keys', () => {
    expect(resolvePlatform(undefined)).toBeUndefined();
    expect(resolvePlatform('myspace')).toBeUndefined();
    expect(resolvePlatform('toString')).toBeUndefined();
  });

  it('carries the TikTok numbers the warnings quote', () => {
    const tiktok = resolvePlatform('tiktok');

    expect(tiktok?.safe).toEqual({ top: 0.1, bottom: 0.22, left: 0.05, right: 0.14 });
    expect(tiktok?.maxDuration).toBe(600);
    expect(platformLoudnorm(tiktok!)).toBe('loudnorm=I=-14:TP=-1:LRA=11');
  });

  it('lists every platform with its aliases in the catalog and the motion catalog', () => {
    const catalog = platformCatalog();

    expect(catalog.map((entry) => entry.id)).toEqual(PLATFORM_IDS);
    expect(catalog.find((entry) => entry.id === 'reels')?.aliases).toEqual(['ig', 'instagram']);
    expect(motionCatalog().platforms).toEqual(catalog);
  });
});

describe('global.platform schema', () => {
  it('accepts every id and alias and rejects anything else', () => {
    for (const name of PLATFORM_NAMES) {
      expect(GlobalConfigSchema.safeParse({ platform: name }).success).toBe(true);
    }

    expect(GlobalConfigSchema.safeParse({ platform: 'myspace' }).success).toBe(false);
  });
});

describe('global.platform orientation default', () => {
  const videoConfig = { scale: '1280:720' };

  it('renders a TikTok template portrait when no orientation is authored', () => {
    expect(resolveBuildVideoConfig(videoConfig, { global: { platform: 'tiktok' } })?.scale).toBe('720:1280');
    expect(effectiveOrientation({ platform: 'square-feed' })).toBe('square');
  });

  it('lets an authored orientation win over the platform', () => {
    const descriptor = { global: { platform: 'tiktok' as const, orientation: 'landscape' } };

    expect(resolveBuildVideoConfig(videoConfig, descriptor)?.scale).toBe('1280:720');
  });

  it('leaves a template without a platform on the landscape default', () => {
    expect(resolveBuildVideoConfig(videoConfig, { global: {} })?.scale).toBe('1280:720');
  });
});

describe('default caption with a platform', () => {
  const text = { en: 'Hello' };

  it('lifts the default caption clear of the bottom UI', () => {
    const [filter] = captionToFilters({ text }, { scale: '720:1280', platform: 'tiktok' });

    // ceil(1280 * 0.22) = 282, plus 24px clearance for the box padding.
    expect(filter.values?.y).toBe('(h-text_h)-306');
  });

  it('keeps an authored position exactly where the author put it', () => {
    const [filter] = captionToFilters({ text, position: 'bottom' }, { scale: '720:1280', platform: 'tiktok' });

    expect(filter.values?.y).toBe('(h-text_h)-60');
  });

  it('never moves a caption below the preset offset, and is unchanged without a platform', () => {
    const [landscape] = captionToFilters({ text }, { scale: '1280:720', platform: 'youtube' });
    const [none] = captionToFilters({ text }, { scale: '720:1280' });

    expect(landscape.values?.y).toBe('(h-text_h)-110');
    expect(none.values?.y).toBe('(h-text_h)-110');
  });
});

describe('platform geometry warnings', () => {
  it('names the edge and the UI covering text under the app chrome', async () => {
    const warnings = await collectGeometryWarnings(
      template({ platform: 'tiktok' }, [card({ text: { en: 'Low' }, position: 'bottom', fontsize: 40 })])
    );
    const overlap = warnings.find((warning) => warning.code === 'platform_ui_overlap');

    expect(overlap?.path).toBe('sections[0].caption');
    expect(overlap?.message).toContain("bottom 22% is covered by TikTok's caption block");
  });

  it('keeps the default caption clear of the UI it was lifted above', async () => {
    const warnings = await collectGeometryWarnings(
      template({ platform: 'tiktok' }, [card({ text: { en: 'Clear' }, fontsize: 40 })])
    );

    expect(warnings.filter((warning) => warning.code === 'platform_ui_overlap')).toEqual([]);
  });

  it('keeps the title-safe rule when no platform is set', async () => {
    const warnings = await collectGeometryWarnings(
      template({ orientation: 'portrait' }, [card({ text: { en: 'Low' }, position: 'bottom', fontsize: 40 })])
    );

    expect(warnings.some((warning) => warning.code === 'platform_ui_overlap')).toBe(false);
  });

  it('reports the excess over the platform duration limit', async () => {
    const sections = [card(undefined, 60), { ...card(undefined, 45), name: 'b' }];
    const warnings = await collectGeometryWarnings(template({ platform: 'reels' }, sections));
    const exceeded = warnings.find((warning) => warning.code === 'platform_duration_exceeded');

    expect(exceeded?.message).toContain('105.0s, 15.0s over Instagram Reels');
    expect(exceeded?.approx).toBe(false);
  });

  it('flags an off-platform fps and orientation as advice', async () => {
    const warnings = await collectGeometryWarnings(
      template({ platform: 'shorts', fps: 120, orientation: 'landscape' }, [card()])
    );
    const codes = warnings.map((warning) => warning.code);

    expect(codes).toContain('platform_fps_mismatch');
    expect(codes).toContain('platform_orientation_mismatch');
    expect(new Set(warnings.map((warning) => warning.severity))).toEqual(new Set(['warn']));
  });

  it('says nothing about duration within the limit', async () => {
    const warnings = await collectGeometryWarnings(template({ platform: 'x' }, [card(undefined, 30)]));

    expect(warnings.some((warning) => warning.code.startsWith('platform_'))).toBe(false);
  });
});
