import 'reflect-metadata';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const ENV_KEYS = [
  'LECLAP_MCP_OUTPUT_DIR',
  'LECLAP_MCP_MEDIA_DIR',
  'LECLAP_MCP_RENDER_TIMEOUT_MS',
  'LECLAP_MCP_ALLOW_REMOTION',
  'LECLAP_MCP_EFFECT_CACHE_MAX_BYTES',
  'LECLAP_MCP_EFFECT_CATALOG',
] as const;

describe('loadConfig', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  });

  it('falls back to defaults when nothing is provided', () => {
    const config = loadConfig([]);

    expect(config.outputDir).toBe(path.join(os.homedir(), '.leclap', 'renders'));
    expect(config.mediaDir).toBe(path.join(os.homedir(), '.leclap', 'media'));
    expect(config.renderTimeoutMs).toBe(600_000);
    expect(config.allowRemotion).toBe(false);
  });

  it('defaults cache to 512 MiB and accepts zero, flags and env values', () => {
    expect(loadConfig([]).effectCacheMaxBytes).toBe(512 * 1024 * 1024);
    process.env.LECLAP_MCP_EFFECT_CACHE_MAX_BYTES = '42';
    expect(loadConfig([]).effectCacheMaxBytes).toBe(42);
    expect(loadConfig(['--effect-cache-max-bytes=0']).effectCacheMaxBytes).toBe(0);
    expect(loadConfig(['--effect-cache-max-bytes', '100']).effectCacheMaxBytes).toBe(100);
  });

  it.each(['-1', '1.5', '10bytes', 'NaN', '', '9007199254740992', '1e3', ' 10'])(
    'defaults invalid cache budget %s',
    (raw) => {
      expect(loadConfig([`--effect-cache-max-bytes=${raw}`]).effectCacheMaxBytes).toBe(512 * 1024 * 1024);
    }
  );

  it('enables Remotion only when explicitly opted in', () => {
    expect(loadConfig([]).allowRemotion).toBe(false);
    expect(loadConfig(['--allow-remotion']).allowRemotion).toBe(true);
    expect(loadConfig(['--allow-remotion=true']).allowRemotion).toBe(true);
    expect(loadConfig(['--allow-remotion=false']).allowRemotion).toBe(false);

    process.env.LECLAP_MCP_ALLOW_REMOTION = '1';
    expect(loadConfig([]).allowRemotion).toBe(true);
  });

  it('does not let a bare --allow-remotion swallow the following argument', () => {
    const config = loadConfig(['--allow-remotion', '--media-dir', '/tmp/flag-media']);

    expect(config.allowRemotion).toBe(true);
    expect(config.mediaDir).toBe('/tmp/flag-media');
  });

  it('reads values from env vars', () => {
    process.env.LECLAP_MCP_OUTPUT_DIR = '/tmp/env-out';
    process.env.LECLAP_MCP_MEDIA_DIR = '/tmp/env-media';
    process.env.LECLAP_MCP_RENDER_TIMEOUT_MS = '1234';

    const config = loadConfig([]);

    expect(config.outputDir).toBe('/tmp/env-out');
    expect(config.mediaDir).toBe('/tmp/env-media');
    expect(config.renderTimeoutMs).toBe(1234);
  });

  it('lets CLI flags override env vars', () => {
    process.env.LECLAP_MCP_OUTPUT_DIR = '/tmp/env-out';
    process.env.LECLAP_MCP_MEDIA_DIR = '/tmp/env-media';
    process.env.LECLAP_MCP_RENDER_TIMEOUT_MS = '1234';

    const config = loadConfig([
      '--output-dir',
      '/tmp/flag-out',
      '--media-dir=/tmp/flag-media',
      '--render-timeout-ms',
      '5000',
    ]);

    expect(config.outputDir).toBe('/tmp/flag-out');
    expect(config.mediaDir).toBe('/tmp/flag-media');
    expect(config.renderTimeoutMs).toBe(5000);
  });

  it('falls back to the default timeout on NaN or non-positive values', () => {
    expect(loadConfig(['--render-timeout-ms', 'not-a-number']).renderTimeoutMs).toBe(600_000);
    expect(loadConfig(['--render-timeout-ms', '0']).renderTimeoutMs).toBe(600_000);
    expect(loadConfig(['--render-timeout-ms', '-10']).renderTimeoutMs).toBe(600_000);
  });

  it('resolves relative dirs to absolute paths', () => {
    const config = loadConfig(['--output-dir', 'relative/out', '--media-dir', 'relative/media']);

    expect(config.outputDir).toBe(path.resolve('relative/out'));
    expect(config.mediaDir).toBe(path.resolve('relative/media'));
    expect(path.isAbsolute(config.outputDir)).toBe(true);
    expect(path.isAbsolute(config.mediaDir)).toBe(true);
  });
});

it('resolves the operator catalog with CLI precedence', () => {
  const saved = process.env.LECLAP_MCP_EFFECT_CATALOG;
  try {
    process.env.LECLAP_MCP_EFFECT_CATALOG = 'env-catalog.json';
    expect(loadConfig([]).effectCatalogPath).toBe(path.resolve('env-catalog.json'));
    expect(loadConfig(['--effect-catalog', 'cli.json']).effectCatalogPath).toBe(path.resolve('cli.json'));
    expect(loadConfig(['--effect-catalog=inline.json']).effectCatalogPath).toBe(path.resolve('inline.json'));
    delete process.env.LECLAP_MCP_EFFECT_CATALOG;
    expect(loadConfig([]).effectCatalogPath).toBeUndefined();
  } finally {
    if (saved === undefined) delete process.env.LECLAP_MCP_EFFECT_CATALOG;
    if (saved !== undefined) process.env.LECLAP_MCP_EFFECT_CATALOG = saved;
  }
});

describe('loadConfig empty and oversized values', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  });

  it('treats an empty --media-dir as unset instead of the working directory', () => {
    const config = loadConfig(['node', 'server', '--media-dir', '']);

    expect(config.mediaDir).toBe(path.join(os.homedir(), '.leclap', 'media'));
  });

  it('treats an empty LECLAP_MCP_MEDIA_DIR as unset', () => {
    process.env.LECLAP_MCP_MEDIA_DIR = '';

    const config = loadConfig(['node', 'server']);

    expect(config.mediaDir).toBe(path.join(os.homedir(), '.leclap', 'media'));
  });

  it('does not let an empty flag override a valid environment value', () => {
    process.env.LECLAP_MCP_OUTPUT_DIR = '/srv/renders';

    const config = loadConfig(['node', 'server', '--output-dir', '']);

    expect(config.outputDir).toBe('/srv/renders');
  });

  it('falls back to the default timeout when the value exceeds the Node timer range', () => {
    const config = loadConfig(['node', 'server', '--render-timeout-ms', '3000000000']);

    expect(config.renderTimeoutMs).toBe(600_000);
  });
});
