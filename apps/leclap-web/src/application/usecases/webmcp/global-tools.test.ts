import { describe, expect, it } from 'vitest';
import { STARTER_PRESETS, buildDescriptor } from '@leclap/creative-kit/editor';
import { BUILTIN_THEMES } from 'ffmpeg-video-composer/src/core/theme/themes.ts';
import { createFakePort, toolCaller } from './fake-port';
import { GLOBAL_TOOLS } from './global-tools';

async function setup() {
  const port = createFakePort(STARTER_PRESETS[0].build());
  const call = toolCaller(port);
  const revision = (await call('get_template')).data.revision as string;

  return { port, call, revision };
}

describe('set_theme', () => {
  it('sets a built-in theme as one undo step, and null removes it', async () => {
    const { port, call, revision } = await setup();
    const before = port.getState();
    const result = await call('set_theme', { expectedRevision: revision, theme: 'midnight' });

    expect(result.isError).toBeUndefined();
    expect(buildDescriptor(port.getState()).global?.theme).toBe('midnight');
    expect(port.commits).toHaveLength(1);

    const cleared = await call('set_theme', { expectedRevision: result.data.revision, theme: null });

    expect(cleared.isError).toBeUndefined();
    expect(buildDescriptor(port.getState()).global?.theme).toBeUndefined();
    port.undo();
    port.undo();
    expect(port.getState()).toBe(before);
  });

  it('names every built-in theme, and sets the newer ones too', async () => {
    const description = GLOBAL_TOOLS.find((tool) => tool.name === 'set_theme')?.description ?? '';

    for (const name of Object.keys(BUILTIN_THEMES)) expect(description).toContain(name);

    const { port, call, revision } = await setup();

    expect((await call('set_theme', { expectedRevision: revision, theme: 'sunset' })).isError).toBeUndefined();
    expect(buildDescriptor(port.getState()).global?.theme).toBe('sunset');
  });

  it('refuses a stale revision and an invalid theme without committing', async () => {
    const { port, call, revision } = await setup();

    expect((await call('set_theme', { expectedRevision: 'stale', theme: 'neon' })).data.code).toBe('revision_conflict');
    expect((await call('set_theme', { expectedRevision: revision, theme: { colors: { accent: 42 } } })).data.code).toBe(
      'invalid_template'
    );
    expect(port.commits).toHaveLength(0);
  });
});

describe('set_format', () => {
  it('sets the orientation and the delivery platform', async () => {
    const { port, call, revision } = await setup();
    const result = await call('set_format', {
      expectedRevision: revision,
      orientation: 'portrait',
      platform: 'tiktok',
    });

    expect(result.isError).toBeUndefined();
    expect(port.getState().orientation).toBe('portrait');
    expect(buildDescriptor(port.getState()).global).toMatchObject({ orientation: 'portrait', platform: 'tiktok' });

    await call('set_format', { expectedRevision: result.data.revision, platform: null });
    expect(buildDescriptor(port.getState()).global?.platform).toBeUndefined();
  });

  it('needs at least one setting and a known platform', async () => {
    const { call, revision } = await setup();

    expect((await call('set_format', { expectedRevision: revision })).data.code).toBe('invalid_input');
    expect((await call('set_format', { expectedRevision: revision, platform: 'myspace' })).data.code).toBe(
      'invalid_input'
    );
  });
});

describe('set_music', () => {
  it('adds library tracks, volumes and ducking as one step, with the music scene highlighted', async () => {
    const { port, call, revision } = await setup();
    const result = await call('set_music', {
      expectedRevision: revision,
      tracks: ['lofi-cafe', 'point-being'],
      musicVolume: 0.3,
      ducking: true,
    });

    expect(result.isError).toBeUndefined();
    const global = buildDescriptor(port.getState()).global;

    expect(global).toMatchObject({ musicEnabled: true, allowedMusic: ['lofi-cafe', 'point-being'] });
    expect(global?.audio).toMatchObject({ musicVolume: 0.3 });
    expect(global?.audio?.ducking).toBeTruthy();
    expect(port.getState().sections.some((section) => section.kind === 'music')).toBe(true);
    expect(port.commits).toHaveLength(1);
    expect(port.commits[0].changed.length).toBeGreaterThan(0);
  });

  it('refuses unknown track ids with the valid ones, and an empty call', async () => {
    const { port, call, revision } = await setup();
    const unknown = await call('set_music', { expectedRevision: revision, tracks: ['not-a-track'] });

    expect(unknown.data.code).toBe('not_found');
    expect(String(unknown.data.hint)).toContain('lofi-cafe');
    expect((await call('set_music', { expectedRevision: revision })).data.code).toBe('invalid_input');
    expect(port.commits).toHaveLength(0);
  });

  it('asks first when the user wants every edit confirmed; a decline changes nothing', async () => {
    const { port, call, revision } = await setup();
    port.ask = true;
    port.answers = [false];

    expect((await call('set_music', { expectedRevision: revision, musicVolume: 0.2 })).data.code).toBe('user_declined');
    expect(port.confirms[0]).toMatchObject({ tool: 'set_music', kind: 'edit' });
    expect(port.commits).toHaveLength(0);
  });
});
