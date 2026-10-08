import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpConfig } from '../src/config.js';
import { registerTranscribeMedia, type MediaTranscriber } from '../src/tools/transcribe-media.js';

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

function captureHandler(cfg: McpConfig, transcriber: MediaTranscriber): { name: string; handler: Handler } {
  let captured: { name: string; handler: Handler } | undefined;
  const fakeServer = {
    registerTool: (name: string, _meta: unknown, cb: Handler) => {
      captured = { name, handler: cb };
    },
  };

  registerTranscribeMedia(fakeServer as never, cfg, transcriber);

  if (!captured) throw new Error('handler was not registered');

  return captured;
}

const TRANSCRIPT = {
  engine: 'whisper.cpp',
  model: 'base',
  language: 'en',
  words: [
    { text: 'Hello', start: 0.5, end: 0.9, confidence: 0.4 },
    { text: 'there,', start: 1, end: 1.3, confidence: 0.5 },
    { text: 'world.', start: 1.4, end: 1.8, confidence: 0.45 },
  ],
};

let mediaDir: string;
let outsideDir: string;
let config: McpConfig;

beforeEach(async () => {
  mediaDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-speech-')));
  outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-outside-')));
  config = { outputDir: mediaDir, mediaDir, renderTimeoutMs: 1000, allowRemotion: false };
});

afterEach(async () => {
  await fs.rm(mediaDir, { recursive: true, force: true });
  await fs.rm(outsideDir, { recursive: true, force: true });
});

describe('transcribe_media', () => {
  it('registers under its name', () => {
    expect(captureHandler(config, vi.fn()).name).toBe('transcribe_media');
  });

  it('returns words, SRT, language and confidence, with the pin-then-review advice', async () => {
    const clip = path.join(mediaDir, 'talk.m4a');
    await fs.writeFile(clip, 'audio');
    const transcriber = vi.fn(async () => TRANSCRIPT);
    const { handler } = captureHandler(config, transcriber);
    const result = await handler({ path: clip, language: 'en', model: 'tiny' });

    expect(transcriber).toHaveBeenCalledWith(clip, { language: 'en', model: 'tiny', signal: undefined });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      language: 'en',
      engine: 'whisper.cpp',
      wordCount: 3,
      confidence: 0.45,
      lowConfidence: true,
      words: TRANSCRIPT.words,
    });
    expect(result.structuredContent?.srt).toContain('Hello there, world.');
    expect(result.structuredContent?.advice).toMatch(/subtitles\.words/);
    expect(result.structuredContent?.advice).toMatch(/review/i);
  });

  it('refuses a language that is not a BCP-47 tag without transcribing', async () => {
    const clip = path.join(mediaDir, 'talk.m4a');
    await fs.writeFile(clip, 'audio');
    const transcriber = vi.fn();
    const result = await captureHandler(config, transcriber).handler({
      path: clip,
      language: 'en:destination=/tmp/pwn',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('BCP-47');
    expect(transcriber).not.toHaveBeenCalled();
  });

  it('refuses a path outside the media dir without transcribing', async () => {
    const clip = path.join(outsideDir, 'talk.m4a');
    await fs.writeFile(clip, 'audio');
    const transcriber = vi.fn();
    const result = await captureHandler(config, transcriber).handler({ path: clip });

    expect(result.isError).toBe(true);
    expect(transcriber).not.toHaveBeenCalled();
  });

  it('reports a missing transcriber or model as a tool error', async () => {
    const clip = path.join(mediaDir, 'talk.m4a');
    await fs.writeFile(clip, 'audio');
    const transcriber = vi.fn(async () => {
      throw new Error('whisper_model_missing: the whisper "base" model is not downloaded');
    });
    const result = await captureHandler(config, transcriber).handler({ path: clip });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/whisper_model_missing/);
  });
});
