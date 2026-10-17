import { describe, expect, it } from 'vitest';
import type { RenderManifest } from 'ffmpeg-video-composer';
import { rerenderConfig } from '../src/commands/verify';

// A manifest is a file from anywhere: its descriptor is validated again before it is re-rendered, as it
// was for the recorded render (the build clones the descriptor, so the recorded one is the authored one).

const manifest = {
  schemaVersion: 1,
  engine: { name: 'ffmpeg-video-composer', version: '3.1.0' },
  ffmpeg: { version: '8.1.1' },
  deterministic: true,
  template: { sha256: 'aaaa', seed: 0, descriptor: {} },
  config: {},
  assets: [],
  graph: { sha256: 'gggg', commands: [] },
  output: { sha256: 'oooo', bytes: 10 },
} as unknown as RenderManifest;

describe('verify --rerender config', () => {
  it('validates the recorded descriptor instead of skipping the schema', () => {
    const config = rerenderConfig({ manifest, buildDir: '/tmp/b', assetsDir: '/tmp/a', inputs: {} });

    expect(config.skipValidation).not.toBe(true);
  });
});

describe('verify --rerender --allow-raw-filters', () => {
  it('keeps the authored-filter allow-list by default', () => {
    expect(
      rerenderConfig({ manifest, buildDir: '/tmp/b', assetsDir: '/tmp/a', inputs: {} }).allowRawFilters
    ).toBeFalsy();
  });

  it('trusts the recorded template raw filters only when asked', () => {
    const config = rerenderConfig({
      manifest,
      buildDir: '/tmp/b',
      assetsDir: '/tmp/a',
      inputs: {},
      allowRawFilters: true,
    });

    expect(config.allowRawFilters).toBe(true);
  });
});
