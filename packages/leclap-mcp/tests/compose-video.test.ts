import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpConfig } from '../src/config.js';
import { runRender } from '../src/compose/renderRunner.js';
import { registerCompose } from '../src/tools/composeVideo.js';

vi.mock('../src/compose/renderRunner.js', () => ({
  runRender: vi.fn(),
}));

const runRenderMock = vi.mocked(runRender);

// Minimal McpServer stand-in: captures the handler the tool registers so we can invoke it
// directly with crafted args, no transport needed. The context is optional here for the same reason
// it is optional in the handler: most cases don't need a client to notify.
type Ctx = { mcpReq: { signal?: AbortSignal } };
type Handler = (args: Record<string, unknown>, ctx?: Ctx) => unknown;

function captureHandler(cfg: McpConfig): Handler {
  let captured: Handler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _meta: unknown, cb: Handler) => {
      captured = cb;
    },
  };

  registerCompose(fakeServer as never, cfg);

  if (!captured) {
    throw new Error('handler was not registered');
  }

  return captured;
}

let outputDir: string;
let mediaDir: string;
let config: McpConfig;

beforeEach(async () => {
  vi.clearAllMocks();
  outputDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-out-')));
  mediaDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-media-')));
  config = { outputDir, mediaDir, renderTimeoutMs: 1000, allowRemotion: false };
});

afterEach(async () => {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.rm(mediaDir, { recursive: true, force: true });
});

function setup() {
  return captureHandler(config);
}

// A minimal valid inline descriptor with a single project_video named `video_1`; the compose handler
// rejects before rendering unless that clip is supplied.
const clipTemplate: Record<string, unknown> = {
  global: { orientation: 'landscape', musicEnabled: false },
  sections: [{ name: 'video_1', type: 'project_video', options: { duration: 5 } }],
};

// Stage a real file under the media dir so the path-safety check passes and the (mocked) render is
// reached.
async function stageClip(name = 'video_1'): Promise<Record<string, string>> {
  const clip = path.join(mediaDir, 'clip.mp4');
  await fs.writeFile(clip, 'stub');

  return { [name]: clip };
}

// The mocked `outputPath` is deliberately nested one level deeper than the temp root. On a
// successful render `finalizeRender` calls `pruneRenderDir(path.dirname(outputPath))`, which
// `fs.rm`s every entry in that directory except the deliverable — so mocking `/tmp/out.mp4` made
// running this file delete the contents of the machine's entire /tmp. It cost a CI runner's scratch
// space and several local scratch dirs before anyone noticed, because the suite still passed.
describe('compose_video handler', () => {
  it('returns structuredContent on a successful render', async () => {
    runRenderMock.mockResolvedValue({
      ok: true,
      outputPath: '/tmp/leclap-compose-test/out.mp4',
      durationSeconds: 12.5,
      sizeBytes: 2048,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });

    const result = (await setup()({ template: clipTemplate, userVideoPaths: await stageClip() })) as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      outputPath: '/tmp/leclap-compose-test/out.mp4',
      durationSeconds: 12.5,
      sizeBytes: 2048,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
    expect(result.structuredContent?.renderId).toBeTypeOf('string');
  });

  // Regression guard: assetsDir used to be set to the per-render buildDir, so the engine's
  // staged-read allowlist (assetsDir/tempDir/buildDir) never contained the configured media dir —
  // a descriptor pictureUrl/musicUrl under LECLAP_MCP_MEDIA_DIR was rejected as 'outside the
  // staged media directories' even though probe_media could read the same file.
  it('passes the configured media dir as the engine assetsDir', async () => {
    runRenderMock.mockResolvedValue({
      ok: true,
      outputPath: '/tmp/leclap-compose-test/out.mp4',
      durationSeconds: 1,
      sizeBytes: 1,
      videoCodec: 'h264',
      audioCodec: null,
    });

    await setup()({ template: clipTemplate, userVideoPaths: await stageClip() });

    const job = runRenderMock.mock.calls.at(-1)?.[0] as { projectConfig: { assetsDir?: string; buildDir?: string } };
    expect(job.projectConfig.assetsDir).toBe(mediaDir);
    expect(job.projectConfig.buildDir?.startsWith(outputDir)).toBe(true);
  });

  it('asks the engine for the output QC and returns its report', async () => {
    const qc = {
      verified: false,
      content: true,
      findings: [
        { check: 'duration', status: 'pass', value: 4, expected: 4, reason: 'ok', kind: 'format' },
        {
          check: 'color_tags',
          status: 'warn',
          value: 'bt709/unknown/bt709',
          expected: 'x',
          reason: 'untagged',
          kind: 'format',
        },
      ],
    };
    runRenderMock.mockResolvedValue({
      ok: true,
      outputPath: '/tmp/leclap-compose-test/out.mp4',
      durationSeconds: 4,
      sizeBytes: 1,
      videoCodec: 'h264',
      audioCodec: 'aac',
      qc,
    } as never);

    const result = (await setup()({ template: clipTemplate, userVideoPaths: await stageClip() })) as {
      content: Array<{ type: string; text?: string }>;
      structuredContent?: Record<string, unknown>;
    };
    const job = runRenderMock.mock.calls.at(-1)?.[0] as { projectConfig: { qc?: unknown } };

    expect(job.projectConfig.qc).toEqual({ content: true });
    expect(result.structuredContent?.qc).toEqual(qc);
    expect(result.content[0].text).toContain('QC not verified (color_tags warn: untagged).');
  });

  it('surfaces a render failure (with log tail) as an error result', async () => {
    runRenderMock.mockResolvedValue({
      ok: false,
      error: 'Compilation error: boom',
      logTail: 'ffmpeg said no',
    });

    const result = (await setup()({ template: clipTemplate, userVideoPaths: await stageClip() })) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Compilation error: boom');
    expect(result.content[0].text).toContain('ffmpeg said no');
  });

  it('rejects before rendering when a required project_video clip is missing', async () => {
    // clipTemplate declares a single project_video section named `video_1`.
    const result = (await setup()({ template: clipTemplate })) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('video_1');
    expect(runRenderMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid inline template before rendering', async () => {
    const result = (await setup()({ template: { sections: 'not-an-array' } })) as {
      isError?: boolean;
      content: { text: string }[];
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid template');
    expect(runRenderMock).not.toHaveBeenCalled();
  });
});

const renderOk = {
  ok: true as const,
  outputPath: '/tmp/render/output.mp4',
  durationSeconds: 3,
  sizeBytes: 42,
  videoCodec: 'h264',
  audioCodec: 'aac',
};

describe('compose_video progress', () => {
  // Progress is reported on stderr, not as a `notifications/message`: `ctx.mcpReq.log` is deprecated
  // as of protocol 2026-07-28 (SEP-2577), which names stderr as the STDIO replacement.
  it('writes each progress fraction the runner reports to stderr', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    runRenderMock.mockImplementation(async (_job, opts) => {
      opts.onProgress?.(0.25);
      opts.onProgress?.(1);

      return renderOk;
    });

    await setup()({ template: clipTemplate, userVideoPaths: await stageClip() });

    const lines = stderr.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('[compose_video]'));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('25%');
    expect(lines[1]).toContain('100%');
    stderr.mockRestore();
  });

  it('never writes progress to stdout, which carries the JSON-RPC framing', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    runRenderMock.mockImplementation(async (_job, opts) => {
      opts.onProgress?.(0.5);

      return renderOk;
    });

    await setup()({ template: clipTemplate, userVideoPaths: await stageClip() });

    expect(stdout).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('renders without a context (no client to notify)', async () => {
    runRenderMock.mockResolvedValue(renderOk);

    await expect(setup()({ template: clipTemplate, userVideoPaths: await stageClip() })).resolves.toBeDefined();
  });

  it('returns the output as a resource link', async () => {
    runRenderMock.mockResolvedValue(renderOk);

    const result = (await setup()({ template: clipTemplate, userVideoPaths: await stageClip() })) as {
      content: Array<Record<string, string>>;
    };
    const link = result.content.find((block) => block.type === 'resource_link');

    expect(link).toMatchObject({
      uri: 'file:///tmp/render/output.mp4',
      mimeType: 'video/mp4',
      name: 'output.mp4',
    });
  });
});
