import { describe, expect, it, vi } from 'vitest';
import { listSamples } from 'ffmpeg-video-composer/src/samples.ts';
import { STARTER_PRESETS, buildDescriptor, patch } from '@leclap/creative-kit/editor';
import { createFakePort, toolCaller } from './fake-port';
import { openable } from './sample-loader';
import { RENDER_COOLDOWN_MS } from './consequential-tools';

function preset() {
  return STARTER_PRESETS[0].build();
}

const sampleId = listSamples().find((sample) => openable(sample))?.id ?? '';
const blockedSample = listSamples().find((sample) => !openable(sample))?.id;

describe('replace_template', () => {
  it('asks first, then installs the template as one undoable step', async () => {
    const port = createFakePort();
    const before = port.getState();
    const call = toolCaller(port);
    const template = buildDescriptor(preset());
    const result = await call('replace_template', { template, name: 'Agent draft', note: 'Fresh start' });

    expect(result.isError).toBeUndefined();
    expect(port.confirms[0]).toMatchObject({
      tool: 'replace_template',
      kind: 'consequential',
      note: 'Fresh start',
      detail: { name: 'Agent draft', sections: template.sections?.length },
    });
    expect(port.getState().name).toBe('Agent draft');
    expect(port.getState().id).not.toBe(before.id);
    expect(port.replaces).toHaveLength(1);
    expect((await call('undo')).isError).toBeUndefined();
    expect(port.getState()).toBe(before);
  });

  it('a decline returns user_declined and changes nothing', async () => {
    const port = createFakePort(preset());
    port.answers = [false];
    const before = port.getState();
    const result = await toolCaller(port)('replace_template', { template: buildDescriptor(preset()) });

    expect(result.data.code).toBe('user_declined');
    expect(port.getState()).toBe(before);
    expect(port.activity.at(-1)).toMatchObject({ tool: 'replace_template', status: 'declined' });
  });

  it('refuses an invalid or effect template before asking', async () => {
    const port = createFakePort(preset());
    const call = toolCaller(port);
    const invalid = await call('replace_template', { template: { sections: [{ type: 'nope' }] } });
    const effect = await call('replace_template', {
      template: { sections: [{ name: 'fx', type: 'effect', options: { duration: 2 } }] },
    });
    const media = await call('replace_template', {
      template: { global: { watermark: { url: 'blob:https://x/1' } }, sections: buildDescriptor(preset()).sections },
    });

    expect(invalid.data.code).toBe('invalid_template');
    expect(effect.data.code).toBe('builder_unsupported_section');
    expect(media.data.code).toBe('invalid_input');
    expect(port.confirms).toHaveLength(0);
  });

  it('answers needs_user_attention in a background tab without asking', async () => {
    const port = createFakePort(preset());
    port.visible = false;

    expect((await toolCaller(port)('replace_template', { template: {} })).data.code).toBe('needs_user_attention');
    expect(port.confirms).toHaveLength(0);
  });
});

describe('load_sample', () => {
  it('opens an openable sample after the user allows it, with its title in the dialog', async () => {
    const port = createFakePort(preset());
    const result = await toolCaller(port)('load_sample', { id: sampleId, theme: 'paper' });

    expect(result.isError).toBeUndefined();
    expect(port.confirms[0].detail?.title).toBeTruthy();
    expect(port.getState().name).toBe(result.data.name);
    expect(buildDescriptor(port.getState()).global?.theme).toBe('paper');
  });

  it('refuses unknown and effect samples before asking; a decline keeps the draft', async () => {
    const port = createFakePort(preset());
    const call = toolCaller(port);
    const before = port.getState();

    expect((await call('load_sample', { id: 'nope' })).data.code).toBe('not_found');

    if (blockedSample) {
      expect((await call('load_sample', { id: blockedSample })).data.code).toBe('builder_unsupported_section');
    }

    expect(port.confirms).toHaveLength(0);
    port.answers = [false];
    expect((await call('load_sample', { id: sampleId })).data.code).toBe('user_declined');
    expect(port.getState()).toBe(before);
  });
});

describe('render_preview', () => {
  it('always asks (with an estimate), offers allow-for-session and reports the render time', async () => {
    const port = createFakePort(preset());
    const result = await toolCaller(port)('render_preview');

    expect(result.isError).toBeUndefined();
    expect(result.data).toMatchObject({ status: 'done', seconds: 12 });
    expect(port.confirms[0]).toMatchObject({ tool: 'render_preview', sessionAllowable: true });
    expect(Number(port.confirms[0].detail?.seconds)).toBeGreaterThanOrEqual(10);
    expect(port.renders).toBe(1);
  });

  it('runs at most once every 30 s, counted from an allowed run', async () => {
    const port = createFakePort(preset());
    let time = 0;
    const call = toolCaller(port, () => time);

    port.answers = [false];
    expect((await call('render_preview')).data.code).toBe('user_declined');
    expect((await call('render_preview')).isError).toBeUndefined();
    time = RENDER_COOLDOWN_MS - 1;
    const limited = await call('render_preview');

    expect(limited.data.code).toBe('rate_limited');
    expect(limited.data.retryAfterMs).toBe(1);
    time = RENDER_COOLDOWN_MS;
    expect((await call('render_preview')).isError).toBeUndefined();
    expect(port.renders).toBe(2);
  });

  it('reports a failed render and refuses a draft with errors before asking', async () => {
    const port = createFakePort(preset());
    port.renderOutcome = { status: 'failed', seconds: 3, failure: 'engineUnavailable' };

    expect((await toolCaller(port)('render_preview')).data).toMatchObject({ code: 'render_failed' });

    const broken = createFakePort(patch(preset(), { sections: [] }));

    expect((await toolCaller(broken)('render_preview')).data.code).toBe('invalid_input');
    expect(broken.confirms).toHaveLength(0);
  });

  it('is only one at a time', async () => {
    const port = createFakePort(preset());
    let finish: (() => void) | null = null;
    port.previewRender = () =>
      new Promise((resolve) => {
        finish = () => {
          resolve({ status: 'done', seconds: 1 });
        };
      });
    let time = 0;
    const call = toolCaller(port, () => time);
    const first = call('render_preview');
    await vi.waitFor(() => {
      expect(finish).not.toBeNull();
    });
    // Past the cooldown: what refuses the second call is the render still running.
    time = RENDER_COOLDOWN_MS * 2;

    expect((await call('render_preview')).data.code).toBe('busy');
    (finish as unknown as () => void)();
    expect((await first).isError).toBeUndefined();
  });
});

describe('render_frames', () => {
  it('needs the agent’s own open preview, and never asks', async () => {
    const port = createFakePort(preset());

    expect((await toolCaller(port)('render_frames', { at: [1] })).data.code).toBe('not_found');
    expect(port.confirms).toHaveLength(0);
  });

  it('returns JPEG image parts after a text summary', async () => {
    const port = createFakePort(preset());
    port.framesOutcome = {
      status: 'done',
      durationSeconds: 9,
      frames: [{ at: 1, data: 'AAAA', bytes: 3, width: 960, height: 540 }],
    };
    const result = await toolCaller(port)('render_frames', { at: [1] });

    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.content[1]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });
    expect(result.data.frames).toEqual([{ at: 1, bytes: 3, width: 960, height: 540, mimeType: 'image/jpeg' }]);
    expect(JSON.stringify(result.structuredContent)).not.toContain('AAAA');
  });

  it('caps the number of frames', async () => {
    expect((await toolCaller(createFakePort())('render_frames', { at: [1, 2, 3, 4, 5] })).data.code).toBe(
      'invalid_input'
    );
  });
});

describe('save_template', () => {
  it('reports what blocks saving without asking', async () => {
    const port = createFakePort(patch(preset(), { name: '' }));
    const result = await toolCaller(port)('save_template');

    expect(result.data).toMatchObject({ code: 'save_blocked', blocker: 'name' });
    expect(port.confirms).toHaveLength(0);
  });

  it('saves after the user allows it; a decline saves nothing', async () => {
    const port = createFakePort(patch(preset(), { name: 'Launch' }));
    port.answers = [false];
    const call = toolCaller(port);

    expect((await call('save_template')).data.code).toBe('user_declined');
    expect(port.saved).toEqual([]);
    expect((await call('save_template')).data).toMatchObject({ saved: true, id: port.getState().id });
    expect(port.confirms[1].detail).toEqual({ name: 'Launch' });
  });
});
