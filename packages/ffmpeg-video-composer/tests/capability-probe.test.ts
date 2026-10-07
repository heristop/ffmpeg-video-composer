import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  probeCapabilities,
  probeCapabilitiesUncached,
  type ProbeOutput,
  type ProbeRunner,
} from '@/platform/ffmpeg/capability-probe-node';
import { parseBuildconf, parseFilterNames, parseVersion, probeError } from '@/platform/ffmpeg/capability-parse';
import { filterPath } from '@/platform/ffmpeg/capability-specs';
import { probedCapabilities } from '@/core/capabilities';

const FILTERS = ` ------
 T.. = Timeline support
 TSC = Command support
 ... alphamerge        VV->V      Copy the luma value of the second input into the alpha channel.
 TSC drawtext          V->V       Draw text on top of video frames using libfreetype library.
 T.. gblur             V->V       Apply Gaussian Blur filter.
 ... loudnorm          A->A       EBU R128 loudness normalization
 ... ebur128           A->N       EBU R128 scanner.
 ... lut3d             V->V       Adjust colors using a 3D LUT.
 ... xfade             VV->V      Cross fade one video with another video.
 ... tonemap           V->V       Conversion to/from different dynamic ranges.
 ... subtitles         V->V       Render text subtitles onto input video using the libass library.
 ... ass               V->V       Render ASS subtitles onto input video using the libass library.
`;

const ENCODERS = ` V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)
`;

const BUILDCONF = `  configuration:
    --prefix=/usr
    --enable-gpl
    --enable-libfreetype
    --enable-libfontconfig
    --enable-libfribidi
    --enable-libass
`;

const ok = (stdout = ''): ProbeOutput => ({ code: 0, stdout, stderr: '' });

// A fake FFmpeg 6.1 build: no zscale, and a drawtext that is listed but breaks on render.
function fakeRunner(
  overrides: { version?: string; drawtextFails?: boolean } = {}
): ProbeRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = (async (_binary: string, args: string[]) => {
    calls.push(args);

    if (args.includes('-version')) return ok(`ffmpeg version ${overrides.version ?? '6.1.1'} Copyright\n`);

    if (args.includes('-filters')) return ok(FILTERS);

    if (args.includes('-encoders')) return ok(ENCODERS);

    if (args.includes('-buildconf')) return ok(BUILDCONF);

    if (overrides.drawtextFails && args.some((arg) => arg.startsWith('drawtext='))) {
      return { code: 1, stdout: '', stderr: 'Cannot find a valid font for the family Sans\nError initializing filter' };
    }

    return ok();
  }) as ProbeRunner & { calls: string[][] };

  run.calls = calls;

  return run;
}

describe('capability listing parsers', () => {
  it('reads filter names, skipping the legend', () => {
    const names = parseFilterNames(FILTERS);

    expect(names.has('drawtext')).toBe(true);
    expect(names.has('alphamerge')).toBe(true);
    expect(names.has('=')).toBe(false);
    expect(names.has('zscale')).toBe(false);
  });

  it('reads --enable switches and the version', () => {
    expect([...parseBuildconf(BUILDCONF)]).toEqual(['gpl', 'libfreetype', 'libfontconfig', 'libfribidi', 'libass']);
    expect(parseVersion('ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023')).toBe('6.1.1-3ubuntu5');
    expect(probeError("\n  No such filter: 'zscale'\nError")).toBe("No such filter: 'zscale'");
  });

  it('quotes filter paths', () => {
    expect(filterPath("/tmp/it's.ttf")).toBe(String.raw`'/tmp/it'\\''s.ttf'`);
  });
});

describe('probeCapabilitiesUncached (mocked FFmpeg)', () => {
  it('reports listing gaps, build flags and real-render failures with fixes', async () => {
    const report = await probeCapabilitiesUncached({ run: fakeRunner({ drawtextFails: true }), fontFile: null });

    expect(report.ffmpeg).toEqual({ path: 'ffmpeg', version: '6.1.1' });
    expect(report.features.zscale).toMatchObject({ usable: 'no', detail: 'this build has no zscale filter' });
    expect(report.features.zscale.fix).toContain('libzimg');
    expect(report.features.drawtext.usable).toBe('no');
    expect(report.features.drawtext.detail).toContain('Cannot find a valid font');
    expect(report.features.drawtext.fix).toContain('captions');
    // text_shaping exists in builds linking libfribidi, whatever HarfBuzz says.
    expect(report.features.textShaping).toMatchObject({ usable: 'yes', detail: 'built with libfribidi' });
    expect(report.features.libass.usable).toBe('yes');
    expect(report.features.gpl.usable).toBe('yes');
    expect(report.features.x264ColorParams.usable).toBe('no');
    expect(report.features.x264ColorParams.detail).toContain('older than 7.1');
    expect(report.fonts).toMatchObject({ freetype: true, fontconfig: true, harfbuzz: false, fribidi: true });
    expect(report.encoders).toEqual(['libx264', 'aac']);
  });

  it('runs a one-frame probe with the font file for drawtext', async () => {
    const run = fakeRunner();

    await probeCapabilitiesUncached({ run, fontFile: '/fonts/Oswald.ttf' });

    const drawtext = run.calls.find((args) => args.some((arg) => arg.startsWith('drawtext=')));

    expect(drawtext).toContain("drawtext=fontfile='/fonts/Oswald.ttf':text=Ag:fontsize=24:fontcolor=white:x=4:y=4");
    expect(drawtext).toContain('-frames:v');
  });

  it('accepts x264 colour params on FFmpeg 7.1', async () => {
    const report = await probeCapabilitiesUncached({ run: fakeRunner({ version: '7.1.1' }), fontFile: null });

    expect(report.features.x264ColorParams.usable).toBe('yes');
  });

  it('marks every feature unusable when FFmpeg cannot run', async () => {
    const run: ProbeRunner = async () => ({ code: null, stdout: '', stderr: '' });
    const report = await probeCapabilitiesUncached({ binary: '/nope/ffmpeg', run });

    expect(report.ffmpeg.version).toBeNull();
    expect(report.features.drawtext).toMatchObject({ usable: 'no', detail: '/nope/ffmpeg could not be run' });
  });

  it('folds into engine capabilities: unusable features become missing filters', async () => {
    const report = await probeCapabilitiesUncached({ run: fakeRunner({ drawtextFails: true }), fontFile: null });
    const probed = probedCapabilities(report);

    expect([...(probed.missingFilters ?? [])].sort((a, b) => a.localeCompare(b))).toEqual(['drawtext', 'zscale']);
    expect(probed.gpl).toBe(true);
    expect(probed).toMatchObject({ fribidi: true, harfbuzz: false });
  });
});

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
}

describe.runIf(hasFfmpeg())('probeCapabilities (local FFmpeg)', () => {
  it('probes the real binary once and caches the report', async () => {
    const first = await probeCapabilities();
    const second = await probeCapabilities();

    expect(second).toBe(first);
    expect(first.ffmpeg.version).toMatch(/\d/);
    expect(first.features.xfade.usable).toBe('yes');
    expect(first.features.gblur.usable).toBe('yes');
    expect(first.features.lut3d.usable).toBe('yes');
    expect(first.features.loudnorm.usable).toBe('yes');
    expect(['yes', 'no']).toContain(first.features.drawtext.usable);
    expect(first.encoders.length).toBeGreaterThan(0);
  }, 60_000);
});
