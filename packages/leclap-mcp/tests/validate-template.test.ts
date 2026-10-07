import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runGeometryCheck } from '../src/compose/renderRunner.js';
import { registerValidateTemplate } from '../src/tools/validateTemplate.js';

// `render: true` renders in the forked worker compose_video uses; the fork itself needs the built
// dist/render-worker.js, so here the runner is stubbed and the handler's use of it is what is pinned.
vi.mock('../src/compose/renderRunner.js', () => ({
  runGeometryCheck: vi.fn(),
}));

const runGeometryCheckMock = vi.mocked(runGeometryCheck);

// Same fake-server trick as compose-video.test: capture the registered handler and call it directly.
type Ctx = { mcpReq: { signal?: AbortSignal } };
type Handler = (
  args: Record<string, unknown>,
  ctx?: Ctx
) => Promise<{
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
}>;

let mediaDir = '';
let outputDir = '';

beforeAll(async () => {
  mediaDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-validate-media-')));
  outputDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-validate-out-')));
});

afterAll(async () => {
  await fs.rm(mediaDir, { recursive: true, force: true });
  await fs.rm(outputDir, { recursive: true, force: true });
});

function setup(): Handler {
  let captured: Handler | undefined;
  const fakeServer = {
    registerTool: (_name: string, _meta: unknown, cb: Handler) => {
      captured = cb;
    },
  };

  registerValidateTemplate(fakeServer as never, { mediaDir, outputDir, renderTimeoutMs: 1000 });

  if (!captured) {
    throw new Error('handler was not registered');
  }

  return captured;
}

describe('validate_template handler', () => {
  it('validates an inline descriptor and reports no clips/fields for a color card', async () => {
    // A pure color card — no project_video clips, no form fields.
    const template: Record<string, unknown> = {
      global: { orientation: 'landscape' },
      sections: [{ name: 'card', type: 'color_background', options: { backgroundColor: '#0b0f14', duration: 3 } }],
    };
    const result = await setup()({ template });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ valid: true, requiredClips: [], formFields: [] });
    expect(result.structuredContent?.sectionCount).toBeGreaterThan(0);
    expect(result.structuredContent?.geometry).toBeUndefined();
  });

  it('rejects an invalid inline template with a summarized message', async () => {
    const result = await setup()({ template: { sections: 'not-an-array' } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid template');
  });

  it('returns every finding with its hint, suggestion and kind', async () => {
    const template: Record<string, unknown> = {
      sections: [
        { name: 'card', type: 'color_background', look: 'cinematik', options: { duration: 3, colour: '#000000' } },
      ],
    };
    const result = await setup()({ template });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('→ Rename "colour" to "backgroundColor".');
    expect(result.structuredContent?.valid).toBe(false);
    expect(result.structuredContent?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sections.0.look', code: 'invalid_value', suggestion: 'cinematic' }),
        expect.objectContaining({
          path: 'sections.0.options.colour',
          code: 'unknown_key',
          suggestion: 'backgroundColor',
          kind: 'format',
        }),
      ])
    );
  });

  // Regression guard: a project_video declared inside a `{type:'partial'}` section must surface in
  // requiredClips — the engine expands partials before rendering, so compose_video WILL demand a
  // clip for it, and this tool used to report no clips at all for such templates.
  it('lists a partial-provided project_video section in requiredClips', async () => {
    const template: Record<string, unknown> = {
      partials: [{ id: 'cam', sections: [{ name: 'clip', type: 'project_video', options: { duration: 3 } }] }],
      sections: [{ type: 'partial', ref: 'cam' }],
    };
    const result = await setup()({ template });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ valid: true, requiredClips: ['clip'] });
  });
});

describe('validate_template with render: true', () => {
  const pale: Record<string, unknown> = {
    global: { orientation: 'landscape' },
    sections: [
      {
        name: 'card',
        type: 'color_background',
        options: { backgroundColor: '#ffffff', duration: 2 },
        caption: { text: { en: 'Pale on white' }, style: 'subtle', color: '#eeeeee' },
      },
    ],
  };

  beforeEach(() => {
    runGeometryCheckMock.mockReset();
  });

  it('runs the rendered check in the render worker, with the compose timeout, and reports what it measured', async () => {
    const signal = new AbortController().signal;

    runGeometryCheckMock.mockResolvedValue({
      ok: true,
      geometry: {
        warnings: [
          {
            code: 'text_low_contrast_rendered',
            path: 'sections[0].caption',
            message: '#eeeeee text renders at 1.1:1 against what surrounds it',
            severity: 'warn',
            approx: false,
          },
        ],
        measured: 1,
      },
    });

    const result = await setup()({ template: pale, render: true }, { mcpReq: { signal } });
    const render = result.structuredContent?.render as { measured: number; unavailable?: string };

    expect(runGeometryCheckMock).toHaveBeenCalledWith(
      { kind: 'geometry', descriptor: pale, options: { assetsDir: mediaDir, workDir: outputDir } },
      { timeoutMs: 1000, signal }
    );
    expect(render.unavailable).toBeUndefined();
    expect(render.measured).toBe(1);
    expect(result.structuredContent?.geometry).toEqual([
      'sections[0].caption: #eeeeee text renders at 1.1:1 against what surrounds it',
    ]);
    expect(result.content[0].text).toContain('Rendered check measured 1 text(s) from pixels');
  });

  it('passes on why the worker could not render', async () => {
    runGeometryCheckMock.mockResolvedValue({
      ok: true,
      geometry: { warnings: [], measured: 0, unavailable: 'FFmpeg at ffmpeg (on PATH) has no drawtext filter' },
    });

    const result = await setup()({ template: pale, render: true });

    expect(result.structuredContent?.render).toMatchObject({
      measured: 0,
      unavailable: 'FFmpeg at ffmpeg (on PATH) has no drawtext filter',
    });
  });

  // A worker that times out, crashes or cannot fork is not the template's fault: the render-free
  // findings still come back, with the reason, and the call never becomes an MCP error.
  it('falls back to the render-free findings when the worker times out', async () => {
    runGeometryCheckMock.mockResolvedValue({ ok: false, error: 'render timed out after 1000ms' });

    const result = await setup()({ template: pale, render: true });
    const render = result.structuredContent?.render as { measured: number; unavailable?: string };

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.valid).toBe(true);
    expect(render).toMatchObject({ measured: 0, unavailable: 'rendered check failed: render timed out after 1000ms' });
    expect(result.structuredContent?.geometry).toEqual([expect.stringContaining('#eeeeee on #ffffff is 1.2:1')]);
    expect(result.content[0].text).toContain('Rendered check skipped — rendered check failed: render timed out');
  });

  it('falls back the same way when the runner itself throws', async () => {
    runGeometryCheckMock.mockRejectedValue(new Error('spawn EMFILE'));

    const result = await setup()({ template: pale, render: true });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.render).toMatchObject({ unavailable: 'rendered check failed: spawn EMFILE' });
    expect(result.structuredContent?.geometry).toEqual([expect.stringContaining('#eeeeee on #ffffff is 1.2:1')]);
  });

  it('does not render unless asked', async () => {
    const result = await setup()({ template: pale });

    expect(result.structuredContent?.render).toBeUndefined();
    expect(result.structuredContent?.geometry).toEqual([expect.stringContaining('#eeeeee on #ffffff is 1.2:1')]);
    expect(runGeometryCheckMock).not.toHaveBeenCalled();
  });

  // It renders what compose_video would, so it refuses what compose_video would refuse.
  it('does not render a descriptor that escapes the media sandbox', async () => {
    const escaping: Record<string, unknown> = {
      sections: [
        {
          name: 'card',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 2 },
          filters: [{ type: 'curves', value: 'psfile=/etc/passwd' }],
        },
      ],
    };
    const result = await setup()({ template: escaping, render: true });
    const render = result.structuredContent?.render as { measured: number; unavailable?: string };

    expect(render.measured).toBe(0);
    expect(render.unavailable).toMatch(/^not rendered: /);
    expect(runGeometryCheckMock).not.toHaveBeenCalled();
  });

  it('reports motion pacing findings under motionWarnings, and in the text block', async () => {
    const still: Record<string, unknown> = {
      sections: [
        {
          name: 'hold',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 6 },
          kinetic: [{ text: { en: 'Hi' }, preset: 'rise' }],
        },
      ],
    };
    const result = await setup()({ template: still });
    const warnings = result.structuredContent?.motionWarnings as Array<{ code: string; hint?: string }>;

    expect(result.isError).toBeUndefined();
    expect(warnings.map((w) => w.code)).toContain('dead_air');
    expect(warnings.every((w) => typeof w.hint === 'string')).toBe(true);
    expect(result.content[0].text).toContain('motion finding(s)');
    expect(result.content[0].text).toContain('[dead_air]');
  });

  it('omits motionWarnings for a well-paced template', async () => {
    const paced: Record<string, unknown> = {
      sections: [
        {
          name: 'beat',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 3 },
          camera: { preset: 'push-in', amount: 0.05 },
          kinetic: [{ text: { en: 'Hi there' }, preset: 'rise' }],
        },
      ],
    };
    const result = await setup()({ template: paced });

    expect(result.structuredContent?.motionWarnings).toBeUndefined();
  });

  it('fails a template whose motion assertion does not hold', async () => {
    const late: Record<string, unknown> = {
      sections: [
        {
          name: 'beat',
          type: 'color_background',
          options: { backgroundColor: '#000000', duration: 3 },
          kinetic: [{ text: { en: 'Hi' }, preset: 'rise', delay: 1 }],
          assert: [{ visibleBy: { target: 'kinetic[0]', at: 0.5 } }],
        },
      ],
    };
    const result = await setup()({ template: late });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('visibleBy: "kinetic[0]" finishes entering at');
  });
});
