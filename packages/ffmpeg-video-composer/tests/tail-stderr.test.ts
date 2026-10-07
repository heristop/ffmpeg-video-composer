import { describe, expect, it } from 'vitest';
import { spawnFailure, tailStderr } from '@/platform/ffmpeg/tail-stderr';

describe('tailStderr', () => {
  it('keeps the last non-empty lines', () => {
    expect(tailStderr('a\n\nb\n')).toBe('a\nb');
    expect(tailStderr(undefined)).toBe('');
  });
});

describe('spawnFailure', () => {
  it('explains a command line over the OS argument limit', () => {
    expect(spawnFailure({ code: 'E2BIG', message: 'spawn E2BIG' })).toMatch(/argument limit/);
  });

  it('reports other spawn errors by message', () => {
    expect(spawnFailure({ code: 'ENOENT', message: 'spawn ffmpeg ENOENT' })).toBe('spawn ffmpeg ENOENT');
  });

  it('adds nothing for an FFmpeg exit status', () => {
    expect(spawnFailure({ code: 1, message: 'Command failed' })).toBe('');
  });
});
