// Node-only capability doctor: what the FFmpeg binary the engine renders with can really do. Listings
// lie (a filter can be listed and still fail: drawtext without a usable font, zscale without its
// library), so every filter-backed feature also renders one frame through it. One report per binary path
// and version, kept for the life of the process; concurrent callers share one probe.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_FEATURES,
  type CapabilityFeature,
  type CapabilityReport,
  type FeatureStatus,
} from '@/core/capabilities';
import { FFmpegDetector } from './FFmpegDetector';
import { creativeKitCandidates } from '../filesystem/bundled-asset-paths';
import { parseBuildconf, parseFilterNames, parseVersion, probeError } from './capability-parse';
import { FEATURE_SPECS, type ProbeContext } from './capability-specs';

export interface ProbeOutput {
  /** Exit code; null when the binary could not be spawned or timed out. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `<binary> <args>`; injected so the probe is testable without FFmpeg. Never rejects. */
export type ProbeRunner = (binary: string, args: string[]) => Promise<ProbeOutput>;

export interface ProbeOptions {
  /** The FFmpeg to probe (default `ffmpeg` on PATH). */
  binary?: string;
  run?: ProbeRunner;
  /** Font file for the drawtext probe; default a bundled font, null for none (fontconfig's default). */
  fontFile?: string | null;
}

const PROBE_TIMEOUT_MS = 15_000;
const PROBE_FONT = 'Oswald.ttf';

// The exit code of a finished run; null when FFmpeg could not be spawned or was killed by the timeout.
function exitCode(error: { code?: unknown } | null): number | null {
  if (!error) return 0;

  return typeof error.code === 'number' ? error.code : null;
}

/** The default runner: execFile with a timeout; never rejects. */
export function runProbe(binary: string, args: string[]): Promise<ProbeOutput> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: exitCode(error), stdout, stderr });
    });
  });
}

// The bundled font the drawtext probe renders with: next to the built module, else in the creative kit
// (the same walk FilesystemNodeAdapter.resolveBundledFont does).
async function bundledFont(): Promise<string | null> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, 'fonts', PROBE_FONT),
    ...creativeKitCandidates(moduleDir, 'fonts', PROBE_FONT),
  ];
  const present = await Promise.all(
    candidates.map((file) =>
      fs.access(file).then(
        () => true,
        () => false
      )
    )
  );

  return candidates[present.indexOf(true)] ?? null;
}

// A 2³ identity LUT and a one-cue subtitle file, for the lut3d and libass probes.
async function scratchFiles(): Promise<{ dir: string; cube: string; srt: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-caps-'));
  const cube = path.join(dir, 'identity.cube');
  const srt = path.join(dir, 'probe.srt');
  const grid = [0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${r} ${g} ${b}`)));

  await fs.writeFile(cube, ['LUT_3D_SIZE 2', ...grid, ''].join('\n'));
  await fs.writeFile(srt, '1\n00:00:00,000 --> 00:00:01,000\nAg\n');

  return { dir, cube, srt };
}

function unreachable(binary: string): CapabilityReport {
  const status: FeatureStatus = {
    usable: 'no',
    detail: `${binary} could not be run`,
    fix: 'install FFmpeg (a full static build, or the ffmpeg-static package) and put it on PATH',
  };
  const features = Object.fromEntries(CAPABILITY_FEATURES.map((id) => [id, status]));

  return {
    ffmpeg: { path: binary, version: null },
    features: features as CapabilityReport['features'],
    fonts: { bundled: null, freetype: false, fontconfig: false, harfbuzz: false, fribidi: false },
    encoders: [],
  };
}

async function evaluate(id: CapabilityFeature, ctx: ProbeContext, run: ProbeRunner): Promise<FeatureStatus> {
  const spec = FEATURE_SPECS[id];
  const precheck = spec.precheck(ctx);

  if (precheck) return precheck.usable === 'yes' ? precheck : { ...precheck, fix: spec.fix };

  const args = spec.probe?.(ctx);

  if (!args) return { usable: 'yes', detail: spec.ok };

  const result = await run(ctx.binary, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...args]);

  if (result.code === 0) return { usable: 'yes', detail: `${spec.ok} (one-frame render passed)` };

  if (result.code === null) return { usable: 'unknown', detail: 'the one-frame probe timed out', fix: spec.fix };

  return { usable: 'no', detail: `listed, but a one-frame render failed: ${probeError(result.stderr)}`, fix: spec.fix };
}

async function probe(binary: string, run: ProbeRunner, fontFile: string | null, version: string | null) {
  const [filters, encoders, buildconf] = await Promise.all([
    run(binary, ['-hide_banner', '-filters']),
    run(binary, ['-hide_banner', '-encoders']),
    run(binary, ['-hide_banner', '-buildconf']),
  ]);
  const scratch = await scratchFiles();
  const ctx: ProbeContext = {
    binary,
    version,
    filters: parseFilterNames(filters.stdout),
    encoders: FFmpegDetector.parseEncoders(encoders.stdout),
    buildconf: parseBuildconf(buildconf.stdout),
    fontFile,
    scratch,
  };

  try {
    const statuses = await Promise.all(CAPABILITY_FEATURES.map((id) => evaluate(id, ctx, run)));

    return { ctx, features: Object.fromEntries(CAPABILITY_FEATURES.map((id, i) => [id, statuses[i]])) };
  } finally {
    await fs.rm(scratch.dir, { recursive: true, force: true });
  }
}

/** Probes `binary` once (no cache); see {@link probeCapabilities}. */
export async function probeCapabilitiesUncached(options: ProbeOptions = {}): Promise<CapabilityReport> {
  const binary = options.binary ?? 'ffmpeg';
  const run = options.run ?? runProbe;
  const versionOutput = await run(binary, ['-hide_banner', '-version']);

  if (versionOutput.code !== 0) return unreachable(binary);

  const version = parseVersion(versionOutput.stdout);
  const fontFile = options.fontFile === undefined ? await bundledFont() : options.fontFile;
  const { ctx, features } = await probe(binary, run, fontFile, version);
  const flags = ctx.buildconf;

  return {
    ffmpeg: { path: binary, version },
    features: features as CapabilityReport['features'],
    fonts: {
      bundled: fontFile,
      freetype: flags.has('libfreetype'),
      fontconfig: flags.has('libfontconfig') || flags.has('fontconfig'),
      harfbuzz: flags.has('libharfbuzz'),
      fribidi: flags.has('libfribidi'),
    },
    encoders: [...ctx.encoders],
  };
}

const reports = new Map<string, Promise<CapabilityReport>>();

/**
 * The capability report of an FFmpeg binary, cached per binary path and `-version` line: a binary's
 * features do not change under it, and an upgrade in place changes the version line. Never rejects.
 */
export async function probeCapabilities(options: ProbeOptions = {}): Promise<CapabilityReport> {
  const binary = options.binary ?? 'ffmpeg';
  const run = options.run ?? runProbe;
  const versionLine = (await run(binary, ['-version'])).stdout.split('\n').at(0) ?? '';
  const key = `${binary}\n${versionLine}\n${options.fontFile ?? ''}`;
  const known = reports.get(key);

  if (known && !options.run) return known;

  const pending = probeCapabilitiesUncached({ ...options, binary, run });

  if (!options.run) reports.set(key, pending);

  return pending;
}
