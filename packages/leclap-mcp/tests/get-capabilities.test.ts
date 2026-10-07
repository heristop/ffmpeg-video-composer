import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as engine from 'ffmpeg-video-composer';
type CapabilityReport = engine.CapabilityReport;

const probeMock = vi.fn();
const detectMock = vi.fn();

vi.mock('ffmpeg-video-composer', async (importOriginal) => {
  const actual = await importOriginal<typeof engine>();

  return {
    ...actual,
    probeCapabilities: (...args: unknown[]) => probeMock(...args),
    FFmpegDetector: { detect: () => detectMock() },
  };
});

import { capabilityWarnings } from '../src/compose/capabilities.js';
import { registerGetCapabilities } from '../src/tools/getCapabilities.js';

function report(missing: string[]): CapabilityReport {
  const features = Object.fromEntries(
    engine.CAPABILITY_FEATURES.map((id) => [
      id,
      missing.includes(id)
        ? { usable: 'no', detail: `no ${id}`, fix: `install ${id}` }
        : { usable: 'yes', detail: 'ok' },
    ])
  );

  return {
    ffmpeg: { path: 'ffmpeg', version: '6.1.1' },
    features: features as CapabilityReport['features'],
    fonts: { bundled: null, freetype: true, fontconfig: true, harfbuzz: false, fribidi: false },
    encoders: ['libx264'],
  };
}

type Handler = () => Promise<{ content: { text: string }[]; structuredContent: Record<string, unknown> }>;

function handler(): { name: string; meta: Record<string, unknown>; run: Handler } {
  let captured: { name: string; meta: Record<string, unknown>; run: Handler } | undefined;
  const fakeServer = {
    registerTool: (name: string, meta: Record<string, unknown>, run: Handler) => {
      captured = { name, meta, run };
    },
  };

  registerGetCapabilities(fakeServer as never);

  if (!captured) throw new Error('not registered');

  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();
  detectMock.mockResolvedValue({ availability: 'system', version: '6.1.1', path: 'system' });
  probeMock.mockResolvedValue(report(['drawtext']));
});

describe('get_capabilities', () => {
  it('registers a read-only tool', () => {
    const tool = handler();

    expect(tool.name).toBe('get_capabilities');
    expect(tool.meta.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('returns the probe report as structured content and text', async () => {
    const result = await handler().run();

    expect(result.structuredContent).toEqual(report(['drawtext']));
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(probeMock).toHaveBeenCalledWith({ binary: 'ffmpeg' });
  });

  it('probes ffmpeg-static when that is what renders', async () => {
    detectMock.mockResolvedValue({ availability: 'static', version: '6.0', path: '/opt/ffmpeg-static' });
    await handler().run();

    expect(probeMock).toHaveBeenCalledWith({ binary: '/opt/ffmpeg-static' });
  });
});

describe('validate_template feature warnings', () => {
  const template = {
    sections: [{ name: 'a', type: 'color_background', options: { duration: 2 }, caption: { text: { en: 'Hi' } } }],
  };

  it('flags features the local FFmpeg cannot render', async () => {
    const warnings = await capabilityWarnings(template);

    expect(warnings).toEqual([
      expect.objectContaining({ path: 'sections[0].caption', code: 'feature_unavailable', hint: 'install drawtext' }),
    ]);
  });

  it('is absent when everything renders, or when the probe throws', async () => {
    probeMock.mockResolvedValue(report([]));
    expect(await capabilityWarnings(template)).toBeUndefined();

    probeMock.mockRejectedValue(new Error('boom'));
    expect(await capabilityWarnings(template)).toBeUndefined();
  });
});
