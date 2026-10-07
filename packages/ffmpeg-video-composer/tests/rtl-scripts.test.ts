import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '@/index';
import type { Filter, ProjectConfig, TemplateDescriptor } from '@/core/types';
import type { RenderManifest } from '@/core/determinism/manifest';
import { hasRtl, needsShaping, textValues } from '@/core/text-scripts';
import { KineticBlockSchema } from '@/schemas/kinetic.schemas';
import { kineticToFilters } from '@/editor/presets/kinetic';
import { measureBundled } from '@/core/kinetic/layout';
import { coarsenedForScript } from '@/core/kinetic/resolve';
import { engineCapabilities } from '@/editor/utils/filter-compat';
import { DEVICE_LIBRARIES } from '@/editor/utils/device-filters.generated';
import { RTL_UNSHAPED_WARNING, withTextShaping } from '@/editor/utils/text-shaping';
import { textFeaturesFromBuildconf } from '@/platform/ffmpeg/analyze-node';
import { findFont } from '@/core/fonts';
import { TemplateValidator } from '@/services/TemplateValidator';
import { testBuildDir } from './fixtures/build-dir';

const ARABIC = 'مرحبا بالعالم';
const HEBREW = 'שלום עולם';
const FRAME = { width: 1280, height: 720, fps: 30, duration: 3, seed: 7, energy: 1 };

describe('script detection', () => {
  it('flags right-to-left and shaped scripts, not Latin', () => {
    expect(hasRtl(ARABIC)).toBe(true);
    expect(hasRtl(HEBREW)).toBe(true);
    expect(hasRtl('नमस्ते')).toBe(false);
    expect(needsShaping('नमस्ते')).toBe(true);
    expect(needsShaping('สวัสดี')).toBe(true);
    expect(needsShaping('Crème brûlée')).toBe(false);
    expect(textValues({ en: 'a', ar: ARABIC })).toEqual(['a', ARABIC]);
  });
});

describe('kinetic coarsening', () => {
  const cascade = KineticBlockSchema.parse({ text: { ar: ARABIC }, preset: 'cascade', font: 'noto-arabic' });

  it('animates joining scripts a line at a time, placed by drawtext text_w', () => {
    const filters = kineticToFilters(cascade, { ...FRAME, text: ARABIC });

    expect(coarsenedForScript(cascade, ARABIC)).toBe(true);
    expect(coarsenedForScript(cascade, 'Hello world')).toBe(false);
    expect(filters).toHaveLength(1);
    expect(filters[0].values?.text).toBe(ARABIC);
    expect(String(filters[0].values?.x)).toMatch(/^'640\+\(.*\)-text_w\/2'$/);
  });

  it('measures Arabic and Hebrew with the bundled Noto faces (wrapping)', () => {
    expect(findFont('noto-arabic')?.file).toBe('NotoSansArabic.ttf');
    expect(measureBundled('NotoSansArabic.ttf', ARABIC, 100)).toBeGreaterThan(100);
    expect(measureBundled('NotoSansHebrew.ttf', HEBREW, 100)).toBeGreaterThan(100);
    expect(measureBundled('BebasNeue.ttf', ARABIC, 100)).toBeNull();
  });

  it('still draws a line it cannot measure (unbundled font) instead of nothing', () => {
    const line = KineticBlockSchema.parse({ text: { en: 'x' }, preset: 'fade', unit: 'line', font: 'Custom.ttf' });

    expect(kineticToFilters(line, { ...FRAME, text: 'Hello\nworld' })).toHaveLength(2);
  });
});

describe('text shaping capability', () => {
  const drawtext: Filter = { type: 'drawtext', values: { text: { ar: ARABIC } as never, x: 0 } };

  it('follows the probed binary, else the device build config, else off', () => {
    expect(engineCapabilities({}).textShaping).toBe(false);
    expect(engineCapabilities({}, { fribidi: true, harfbuzz: true }).textShaping).toBe(true);
    expect(engineCapabilities({ codecConfig: { videoCodec: 'libopenh264' } } as never).textShaping).toBe(
      DEVICE_LIBRARIES.has('fribidi')
    );
    expect(DEVICE_LIBRARIES.has('fribidi')).toBe(true);
    expect(textFeaturesFromBuildconf('  --enable-libharfbuzz\n  --enable-libfribidi')).toEqual({
      fribidi: true,
      harfbuzz: true,
    });
    expect(textFeaturesFromBuildconf('--enable-libfreetype')).toEqual({ fribidi: false, harfbuzz: false });
  });

  it('sets text_shaping=1 on shaped copy when supported, warns rtl_unshaped otherwise', () => {
    const warnings: string[] = [];
    const caps = engineCapabilities({});

    expect(withTextShaping(drawtext, { ...caps, textShaping: true }, (w) => warnings.push(w)).values).toHaveProperty(
      'text_shaping',
      1
    );
    expect(withTextShaping(drawtext, caps, (w) => warnings.push(w))).toBe(drawtext);
    expect(warnings).toEqual([RTL_UNSHAPED_WARNING]);

    const latin: Filter = { type: 'drawtext', values: { text: { en: 'Hello' }, x: 0 } };
    expect(withTextShaping(latin, { ...caps, textShaping: true }, () => undefined)).toBe(latin);
  });
});

describe('script advisories', () => {
  const template = {
    sections: [
      {
        name: 'a',
        type: 'color_background',
        options: { duration: 2 },
        kinetic: [{ text: { ar: ARABIC }, preset: 'cascade', font: 'noto-arabic', fill: { sweep: {} } }],
      },
    ],
  };

  it('always reports kinetic_unit_coarsened; rtl_unshaped / mask_unavailable only for a named build', () => {
    const validator = new TemplateValidator();
    const codes = (caps?: { textShaping: boolean; masks: boolean }) =>
      validator
        .getMotionWarnings(template, caps)
        .map((w) => w.code)
        .filter((c) => !c.startsWith('ease'));

    expect(codes()).toContain('kinetic_unit_coarsened');
    expect(codes()).not.toContain('rtl_unshaped');
    expect(codes({ textShaping: false, masks: false })).toEqual(
      expect.arrayContaining(['kinetic_unit_coarsened', 'rtl_unshaped', 'mask_unavailable'])
    );
    expect(codes({ textShaping: true, masks: true })).not.toContain('rtl_unshaped');
  });
});

describe('right-to-left render', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const libDir = path.resolve(here, '../../leclap-creative-kit/src/library');
  const config = {
    buildDir: testBuildDir('rtl-render'),
    assetsDir: libDir,
    currentLocale: 'ar',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '640:360' },
  } as unknown as ProjectConfig;
  const descriptor = {
    global: { orientation: 'landscape', musicEnabled: false, seed: 1 },
    sections: [
      {
        name: 'salam',
        type: 'color_background',
        options: { backgroundColor: '#202020', duration: 1 },
        kinetic: [{ text: { ar: ARABIC }, preset: 'rise', font: 'noto-arabic', size: 60 }],
      },
    ],
  } as unknown as TemplateDescriptor;

  it('renders Arabic as whole shaped lines, text_shaping set on a libfribidi build', async () => {
    let manifest: RenderManifest | undefined;
    const output = await compile(config, descriptor, { onManifest: (m) => (manifest = m) });
    const commands = (manifest as RenderManifest).graph.commands.join('\n');

    expect(output).not.toBeNull();
    expect(fs.statSync(output as string).size).toBeGreaterThan(0);
    expect(commands).toContain('NotoSansArabic.ttf');
    expect((commands.match(/drawtext=/g) ?? []).length).toBe(1);
    // The suite's FFmpeg is probed: text_shaping appears exactly when it links libfribidi.
    const probed = commands.includes('text_shaping=1');
    const { ffmpegTextFeatures } = await import('@/platform/ffmpeg/analyze-node');
    const features = await ffmpegTextFeatures('ffmpeg');

    expect(probed).toBe(features?.fribidi ?? false);
  }, 120000);
});
