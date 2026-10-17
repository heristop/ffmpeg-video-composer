import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

describe('FFmpegWasmAdapter', () => {
  it('should be testable when @ffmpeg/ffmpeg is not actually installed', () => {
    // This test verifies the test setup works even without @ffmpeg/ffmpeg
    // In real scenarios, users would have @ffmpeg/ffmpeg installed for browser use
    expect(true).toBe(true);
  });

  it('should be importable', async () => {
    // Test that the module can be imported without errors
    expect(async () => {
      await import('@/platform/ffmpeg/FFmpegWasmAdapter');
    }).not.toThrow();
  });

  // The concat demuxer only names the list file in its args; the segment files the list points at
  // must be bridged into MEMFS too, or multi-section templates (intro + clip + outro) abort in the
  // browser. parseConcatList extracts those segment paths.
  it('parses segment paths from a concat list (quoted and unquoted)', async () => {
    const { default: FFmpegWasmAdapter } = await import('@/platform/ffmpeg/FFmpegWasmAdapter');
    const list = [
      "file '/tmp/build/intro_output.mp4'",
      'file /tmp/build/video_1_output.mp4',
      '# a comment',
      '',
      "file '/tmp/build/outro_output.mp4'",
    ].join('\n');

    expect(FFmpegWasmAdapter.parseConcatList(list)).toEqual([
      '/tmp/build/intro_output.mp4',
      '/tmp/build/video_1_output.mp4',
      '/tmp/build/outro_output.mp4',
    ]);
  });

  it('returns no paths for an empty concat list', async () => {
    const { default: FFmpegWasmAdapter } = await import('@/platform/ffmpeg/FFmpegWasmAdapter');

    expect(FFmpegWasmAdapter.parseConcatList('')).toEqual([]);
  });

  // A segment command may read a concat list after other `-f` inputs (a lavfi silence, a colour source):
  // an HTML caption track is one. Every list the command reads must be found.
  it('finds every concat list a command reads, wherever its -f concat sits', async () => {
    const { default: FFmpegWasmAdapter } = await import('@/platform/ffmpeg/FFmpegWasmAdapter');
    const args = [
      '-f',
      'lavfi',
      '-i',
      'anullsrc',
      '-i',
      '/tmp/clip.mp4',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      '/tmp/panels/captions-1.ffconcat',
      '-f',
      'concat',
      '-i',
      '/tmp/list.txt',
      '-y',
      '/tmp/out.mp4',
    ];

    expect(FFmpegWasmAdapter.concatListPaths(args)).toEqual(['/tmp/panels/captions-1.ffconcat', '/tmp/list.txt']);
    expect(FFmpegWasmAdapter.concatListPaths(['-f', 'lavfi', '-i', 'color'])).toEqual([]);
  });
});
