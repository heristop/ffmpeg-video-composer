import 'reflect-metadata';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { McpConfig } from '../src/config.js';
import { type ProbeRunner, probeMedia, registerProbe } from '../src/tools/probeMedia.js';

const execFileAsync = promisify(execFile);

// Minimal McpServer stand-in: captures the handler the tool registers so we can invoke it
// directly with crafted args, no transport needed.
type Handler = (args: Record<string, unknown>) => unknown;

function captureHandler(cfg: McpConfig, runner?: ProbeRunner): Handler {
  let captured: Handler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _meta: unknown, cb: Handler) => {
      captured = cb;
    },
  };

  registerProbe(fakeServer as never, cfg, runner);

  if (!captured) {
    throw new Error('handler was not registered');
  }

  return captured;
}

let mediaDir: string;
let outsideDir: string;
let config: McpConfig;

beforeEach(async () => {
  mediaDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-media-')));
  outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-outside-')));
  config = { outputDir: mediaDir, mediaDir, renderTimeoutMs: 1000, allowRemotion: false };
});

afterEach(async () => {
  await fs.rm(mediaDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

// Runner that fails loudly if ever called — proves the path guard short-circuits before probing.
const neverRunner: ProbeRunner = async () => {
  throw new Error('runner must not be invoked when the path is rejected');
};

describe('probe_media path guard', () => {
  it('rejects a file outside the media dir', async () => {
    const outside = path.join(outsideDir, 'clip.mp4');
    await fs.writeFile(outside, 'x');

    const result = (await captureHandler(config, neverRunner)({ path: outside })) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/escapes the media/);
  });

  it('rejects a traversal path that climbs out of the media dir', async () => {
    const outside = path.join(outsideDir, 'clip.mp4');
    await fs.writeFile(outside, 'x');
    const traversal = path.join(mediaDir, '..', path.basename(outsideDir), 'clip.mp4');

    const result = (await captureHandler(config, neverRunner)({ path: traversal })) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/escapes the media/);
  });

  it('rejects a relative path', async () => {
    const result = (await captureHandler(config, neverRunner)({ path: 'relative/clip.mp4' })) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/absolute/);
  });
});

describe('probe_media mapping (mocked ffprobe)', () => {
  it('maps streams to the output shape and includes the stat size', async () => {
    const clip = path.join(mediaDir, 'clip.mp4');
    await fs.writeFile(clip, 'video-bytes-here');

    const runner: ProbeRunner = async () => ({
      streams: [
        { codec_type: 'video', codec_name: 'h264', duration: '2.000000' },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100' },
      ],
    });

    const result = (await captureHandler(config, runner)({ path: clip })) as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      durationSeconds: 2,
      videoCodec: 'h264',
      audioCodec: 'aac',
      sampleRate: 44100,
      sizeBytes: (await fs.stat(clip)).size,
    });
  });

  it('falls back to the audio stream duration when the video stream has none', async () => {
    const clip = path.join(mediaDir, 'audio.m4a');
    await fs.writeFile(clip, 'audio');

    const runner: ProbeRunner = async () => ({
      streams: [{ codec_type: 'audio', codec_name: 'aac', duration: '3.5', sample_rate: '48000' }],
    });

    const result = (await captureHandler(config, runner)({ path: clip })) as {
      structuredContent?: Record<string, unknown>;
    };

    expect(result.structuredContent).toMatchObject({
      durationSeconds: 3.5,
      videoCodec: null,
      audioCodec: 'aac',
      sampleRate: 48000,
    });
  });
});

const fixture = fileURLToPath(new URL('../../ffmpeg-engine/tests/fixtures/sample.mp4', import.meta.url));

async function ffprobeAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffprobe', ['-version']);

    return true;
  } catch {
    return false;
  }
}

async function fixtureExists(): Promise<boolean> {
  try {
    await fs.access(fixture);

    return true;
  } catch {
    return false;
  }
}

const realProbeSupported = (await ffprobeAvailable()) && (await fixtureExists());

describe.skipIf(!realProbeSupported)('probe_media real ffprobe', () => {
  it('probes a real local mp4 via the default runner', async () => {
    // The default runner resolves a real ffprobe binary; point the media dir at the fixture's
    // directory so the guard accepts it.
    const fixtureRealDir = await fs.realpath(path.dirname(fixture));
    const realConfig: McpConfig = {
      outputDir: fixtureRealDir,
      mediaDir: fixtureRealDir,
      renderTimeoutMs: 1000,
      allowRemotion: false,
    };

    const result = (await captureHandler(realConfig)({ path: fixture })) as {
      isError?: boolean;
      structuredContent?: {
        durationSeconds: number | null;
        videoCodec: string | null;
        sizeBytes: number;
      };
    };

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.videoCodec).toBe('h264');
    expect(result.structuredContent?.durationSeconds).toBeGreaterThan(0);
    expect(result.structuredContent?.sizeBytes).toBeGreaterThan(0);
  });
});

it('uses WebM stream duration tags before a longer container/audio duration', async () => {
  const result = await probeMedia('/unused.webm', 1, async () => ({
    streams: [
      { codec_type: 'video', codec_name: 'vp9', tags: { DURATION: '00:00:03.500000000' } },
      { codec_type: 'audio', duration: '20' },
    ],
    format: { duration: '20' },
  }));
  expect(result.durationSeconds).toBe(3.5);
});
it('uses container duration for video-only WebM without stream durations', async () => {
  const result = await probeMedia('/unused.webm', 1, async () => ({
    streams: [{ codec_type: 'video', codec_name: 'vp9' }],
    format: { duration: '10.100000' },
  }));
  expect(result.durationSeconds).toBe(10.1);
});
it('does not infer missing video duration from a longer audio stream or container', async () => {
  const result = await probeMedia('/unused.webm', 1, async () => ({
    streams: [
      { codec_type: 'video', codec_name: 'vp9' },
      { codec_type: 'audio', duration: '20' },
    ],
    format: { duration: '20' },
  }));
  expect(result.durationSeconds).toBeNull();
});

it('subtracts video start time from WebM duration tags rather than accepting a short offset clip', async () => {
  const result = await probeMedia('/unused.webm', 1, async () => ({
    streams: [{ codec_type: 'video', codec_name: 'vp9', start_time: '20', tags: { DURATION: '00:00:23.000000000' } }],
    format: { duration: '23', start_time: '20' },
  }));
  expect(result.durationSeconds).toBe(3);
});
it('subtracts start time from single-stream container fallback while preserving true stream duration', async () => {
  for (const duration of [undefined, '3']) {
    const result = await probeMedia('/unused.webm', 1, async () => ({
      streams: [{ codec_type: 'video', codec_name: 'vp9', start_time: '20', duration }],
      format: { duration: '23', start_time: '20' },
    }));
    expect(result.durationSeconds).toBe(3);
  }
});
