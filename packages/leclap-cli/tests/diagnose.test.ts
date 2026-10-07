import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runFullDiagnosticsMock = vi.fn();
const probeCapabilitiesMock = vi.fn();
const detectMock = vi.fn();

vi.mock('ffmpeg-video-composer', () => ({
  FFmpegAvailability: { SYSTEM: 'system', STATIC: 'static', WASM: 'wasm', NONE: 'none' },
  FFmpegDetector: {
    runFullDiagnostics: (...args: unknown[]) => runFullDiagnosticsMock(...args),
    detect: () => detectMock(),
  },
  probeCapabilities: (...args: unknown[]) => probeCapabilitiesMock(...args),
}));

// A probe report: drawtext broken on this build, everything else renders.
const capabilityReport = {
  ffmpeg: { path: 'ffmpeg', version: '6.1' },
  features: {
    drawtext: { usable: 'no', detail: 'listed, but a one-frame render failed', fix: 'install a full build' },
    xfade: { usable: 'yes', detail: 'xfade renders' },
    gblur: { usable: 'unknown', detail: 'the one-frame probe timed out' },
  },
  fonts: { bundled: null, freetype: false, fontconfig: true, harfbuzz: false, fribidi: false },
  encoders: ['libx264'],
};

import { diagnose } from '../src/commands/diagnose';

type Backend = { available: boolean; version?: string; ffprobe?: boolean };

const absent: Backend = { available: false };

function reportWith(ffmpegStatus: { system: Backend; static: Backend; wasm: Backend }) {
  return {
    systemInfo: { os: 'linux x64', arch: 'x64', nodeVersion: 'v24.11.0', packageManager: 'pnpm', memoryGB: 8 },
    ffmpegStatus,
    recommendations: [],
  };
}

// No FFmpeg installed: the render falls back to ffmpeg-static.
function staticOnly(ffprobe?: boolean) {
  return reportWith({ system: absent, static: { available: true, version: '6.0', ffprobe }, wasm: absent });
}

describe('diagnose command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    detectMock.mockResolvedValue({ availability: 'system', version: '6.1', path: 'system' });
    probeCapabilitiesMock.mockResolvedValue(capabilityReport);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => {
      throw new Error(`exit:${code}`);
    }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });

  async function output(report: ReturnType<typeof reportWith>): Promise<string> {
    runFullDiagnosticsMock.mockResolvedValue(report);
    await diagnose.run?.({ args: {} } as never);

    return logSpy.mock.calls.map((call: unknown[]) => stripVTControlCharacters(String(call[0]))).join('\n');
  }

  it('withholds "Ready to render." when ffmpeg-static has no ffprobe', async () => {
    const out = await output(staticOnly(false));

    expect(out).not.toContain('Ready to render.');
    expect(out).toContain('Setup required for templates with transitions, music, overlays or video clips.');
  });

  it('flags the missing ffprobe on the static backend', async () => {
    expect(await output(staticOnly(false))).toContain('✓ static 6.0 (no ffprobe)');
  });

  it('is ready to render once ffmpeg-static has an ffprobe', async () => {
    expect(await output(staticOnly(true))).toContain('Ready to render.');
  });

  // An engine from before the ffprobe check leaves the field out: nothing to flag, same verdict as before.
  it('stays ready to render when the engine does not report an ffprobe', async () => {
    expect(await output(staticOnly())).toContain('Ready to render.');
  });

  it('is ready to render on system FFmpeg, whatever ffmpeg-static lacks', async () => {
    const report = reportWith({
      system: { available: true, version: '8.1' },
      static: { available: true, version: '6.0', ffprobe: false },
      wasm: absent,
    });

    expect(await output(report)).toContain('Ready to render.');
  });

  it('summarizes the probed features and suggests the fixes', async () => {
    const out = await output(staticOnly(true));

    expect(out).toContain('✓ 1/3 features');
    expect(out).toContain('✗ drawtext');
    expect(out).toContain('? gblur');
    expect(out).toContain('drawtext: install a full build');
  });

  it('probes the binary renders use: ffmpeg-static when there is no system FFmpeg', async () => {
    detectMock.mockResolvedValue({ availability: 'static', version: '6.0', path: '/x/ffmpeg-static' });
    await output(staticOnly(true));

    expect(probeCapabilitiesMock).toHaveBeenCalledWith({ binary: '/x/ffmpeg-static' });
  });

  it('prints the capability report as JSON with --json', async () => {
    await diagnose.run?.({ args: { json: true } } as never);

    const written = writeSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('');

    expect(JSON.parse(written)).toEqual(capabilityReport);
    expect(runFullDiagnosticsMock).not.toHaveBeenCalled();
    expect(probeCapabilitiesMock).toHaveBeenCalledWith({ binary: 'ffmpeg' });
  });
});
