import { describe, expect, it } from 'vitest';
import { CompileError, classifyCompileFailure, type CompileFailure } from './compile-failure';

describe('classifyCompileFailure', () => {
  it('reads a clip FFmpeg could not open as an unreadable clip', () => {
    const stderr = new Error(
      'Browser video compilation failed: /tmp/video_1.mp4: moov atom not found\nConversion failed!'
    );

    expect(classifyCompileFailure(stderr)).toEqual({ kind: 'unreadableClip', detail: '' });
  });

  it.each([
    'Invalid data found when processing input',
    '/tmp/intro.mov: detected only with low score of 1, misdetection possible!',
    'Output file #0 does not contain any stream',
  ])('also when FFmpeg says "%s"', (line) => {
    expect(classifyCompileFailure(new Error(line)).kind).toBe('unreadableClip');
  });

  it('reads an engine that handed back nothing as a failed assembly', () => {
    expect(classifyCompileFailure(new Error('Core compilation failed - no output produced'))).toEqual({
      kind: 'assemblyFailed',
      detail: '',
    });
    expect(
      classifyCompileFailure(
        new Error('Browser video compilation failed: Video compilation failed - no output generated')
      ).kind
    ).toBe('assemblyFailed');
    expect(classifyCompileFailure(new Error("ENOENT: No such file '/tmp/build/segments.list'")).kind).toBe(
      'assemblyFailed'
    );
  });

  // The ffmpeg.wasm core never arrives: offline, in each browser's own words; missing from the server; or
  // stuck until the engine stops waiting.
  it.each([
    {
      from: 'Chrome',
      message: 'Browser video compilation failed: Failed to initialize FFmpeg WebAssembly: Failed to fetch',
    },
    {
      from: 'Firefox',
      message:
        'Browser video compilation failed: Failed to initialize FFmpeg WebAssembly: NetworkError when attempting to fetch resource.',
    },
    {
      from: 'Safari',
      message: 'Browser video compilation failed: Failed to initialize FFmpeg WebAssembly: Load failed',
    },
    {
      from: 'the self-hosted core',
      message:
        'Browser video compilation failed: Failed to initialize FFmpeg WebAssembly: ffmpeg core unavailable: /ffmpeg-core/0.12.10/ffmpeg-core.wasm.gz answered 404',
    },
    {
      from: 'a load that hangs',
      message: 'Browser video compilation failed: Timeout waiting for FFmpeg WebAssembly to load',
    },
  ])('reads a wasm core that could not load as an unavailable engine ($from)', ({ message }) => {
    expect(classifyCompileFailure(new Error(message))).toEqual({ kind: 'engineUnavailable', detail: '' });
  });

  it('keeps the first line of anything else, trimmed, as the detail', () => {
    const error = new Error('  Template validation failed: sections[2].type is required  \n    at validateTemplate');

    expect(classifyCompileFailure(error)).toEqual({
      kind: 'unknown',
      detail: 'Template validation failed: sections[2].type is required',
    });
  });

  it('caps the detail at 200 characters', () => {
    expect(classifyCompileFailure(new Error('x'.repeat(300))).detail).toHaveLength(200);
  });

  it('reads a thrown non-error as its string', () => {
    expect(classifyCompileFailure('boom')).toEqual({ kind: 'unknown', detail: 'boom' });
  });

  it('hands back the failure a CompileError already carries', () => {
    const failure: CompileFailure = { kind: 'stopped', detail: '' };

    expect(classifyCompileFailure(new CompileError(failure))).toBe(failure);
  });
});

describe('CompileError', () => {
  it('keeps the original error as its cause, under an English message for the logs', () => {
    const cause = new Error('moov atom not found');
    const error = new CompileError({ kind: 'unreadableClip', detail: '' }, { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CompileError');
    expect(error.cause).toBe(cause);
    expect(error.message).toBe('Render failed (unreadableClip)');
  });

  it('adds the detail to the message when there is one', () => {
    expect(new CompileError({ kind: 'unknown', detail: 'Template validation failed' }).message).toBe(
      'Render failed (unknown): Template validation failed'
    );
  });
});

describe('a stale build', () => {
  it('reads a missing lazily loaded chunk as an app update, not an engine error', () => {
    const error = new Error(
      'Browser video compilation failed: Failed to fetch dynamically imported module: https://leclap.dev/assets/browser-compile-x.js'
    );

    expect(classifyCompileFailure(error)).toEqual({ kind: 'appUpdated', detail: '' });
  });
});
