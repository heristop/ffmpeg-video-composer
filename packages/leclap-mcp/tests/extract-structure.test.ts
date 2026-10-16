import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReferenceStructure } from 'ffmpeg-video-composer';
import { handleExtractStructure } from '../src/tools/extract-structure.js';
import type { McpConfig } from '../src/config.js';

const structure: ReferenceStructure = {
  duration: 2,
  shots: [
    { index: 0, start: 0, end: 1, duration: 1, transitionIn: null, ground: 'dark', anchor: 'left', motion: 0 },
    { index: 1, start: 1, end: 2, duration: 1, transitionIn: 'cut', ground: 'light', anchor: 'center', motion: 0.5 },
  ],
  rhythm: { shots: 2, avgShot: 1, shortest: 1, longest: 1, cutsPerMinute: 30 },
};

function config(mediaDir: string): McpConfig {
  return { outputDir: mediaDir, mediaDir, renderTimeoutMs: 1000, allowRemotion: false } as McpConfig;
}

describe('extract_structure', () => {
  const mediaDir = mkdtempSync(path.join(tmpdir(), 'mcp-structure-'));
  const clip = path.join(mediaDir, 'ref.mp4');
  writeFileSync(clip, 'not decoded: the analyzer is injected');

  it('returns the structure and its binding rules', async () => {
    const result = await handleExtractStructure({ path: clip }, config(mediaDir), async () => structure);

    expect(result).not.toHaveProperty('isError');
    expect(result).toMatchObject({ structuredContent: { structure: { rhythm: { shots: 2 } } } });
    expect(JSON.stringify(result)).toContain('Reference format');
  });

  it('refuses a path outside the media dir', async () => {
    const result = await handleExtractStructure({ path: '/etc/hosts' }, config(mediaDir), async () => structure);

    expect(result).toMatchObject({ isError: true });
  });
});
