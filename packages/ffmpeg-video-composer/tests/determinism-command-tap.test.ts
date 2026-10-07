import { describe, expect, it } from 'vitest';
import {
  BITEXACT_OUTPUT_ARGS,
  applyDeterministicProfile,
  injectOutputArgs,
  tapFFmpegCommands,
} from '@/core/determinism/command-tap';
import { graphDigest, normalizeCommand } from '@/core/determinism/manifest';
import { parseCommand } from '@/platform/ffmpeg/parse-command';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';

describe('injectOutputArgs', () => {
  it('places output options right before the output path', () => {
    const command = ' -y -i in.mp4 -c:v h264 -vf "scale=1280:720,drawtext=text=\'a b\'" /build/out.mp4 ';
    const args = parseCommand(injectOutputArgs(command, '-fflags +bitexact'));

    expect(args.slice(-3)).toEqual(['-fflags', '+bitexact', '/build/out.mp4']);
    expect(args).toContain("scale=1280:720,drawtext=text='a b'");
  });

  it('keeps a quoted output path whole', () => {
    const args = parseCommand(injectOutputArgs('-i a.mp4 -c copy "/tmp/my out.mp4"', '-map_metadata -1'));

    expect(args.slice(-3)).toEqual(['-map_metadata', '-1', '/tmp/my out.mp4']);
  });

  it('leaves a command without inputs untouched', () => {
    expect(injectOutputArgs('-version', '-fflags +bitexact')).toBe('-version');
  });
});

describe('applyDeterministicProfile', () => {
  it('adds bit-exact muxing everywhere and pins libx264 threads', () => {
    const x264 = applyDeterministicProfile('-y -i a.mp4 -c:v h264 -crf 23 out.mp4');
    const copy = applyDeterministicProfile('-y -i a.mp4 -c copy out.mp4');

    expect(x264).toContain(`${BITEXACT_OUTPUT_ARGS} -threads 4 out.mp4`);
    expect(copy).toContain(`${BITEXACT_OUTPUT_ARGS} out.mp4`);
    expect(copy).not.toContain('-threads');
  });
});

describe('tapFFmpegCommands', () => {
  function fakeAdapter(seen: string[]): AbstractFFmpeg {
    return {
      execute: (command: string) => {
        seen.push(command);

        return Promise.resolve({ rc: 0 });
      },
    } as unknown as AbstractFFmpeg;
  }

  it('records and rewrites every command, then restores the adapter', async () => {
    const executed: string[] = [];
    const recorded: string[] = [];
    const adapter = fakeAdapter(executed);
    const original = adapter.execute;
    const restore = tapFFmpegCommands(adapter, { deterministic: true, onCommand: (c) => recorded.push(c) });

    await adapter.execute('-y -i a.mp4 -c copy out.mp4');
    restore();
    await adapter.execute('-y -i b.mp4 -c copy out.mp4');

    expect(recorded).toEqual([executed[0]]);
    expect(executed[0]).toContain('+bitexact');
    expect(executed[1]).toBe('-y -i b.mp4 -c copy out.mp4');
    expect(adapter.execute).toBe(original);
  });

  it('passes commands through unchanged when the profile is off', async () => {
    const executed: string[] = [];
    const adapter = fakeAdapter(executed);
    const restore = tapFFmpegCommands(adapter, { deterministic: false, onCommand: () => {} });

    await adapter.execute('-y -i a.mp4 out.mp4');
    restore();

    expect(executed).toEqual(['-y -i a.mp4 out.mp4']);
  });
});

describe('graph digest', () => {
  const roots = { buildDir: '/home/a/build', tempDir: '/tmp/x', userVideoPaths: { clip: '/media/me/clip.mov' } };

  it('normalizes machine paths and temp suffixes', () => {
    const command = '-y -i /media/me/clip.mov -i /tmp/x/tmp_anim_u3-1791128120864.mp4 /home/a/build/output.mp4';

    expect(normalizeCommand(command, roots)).toBe('-y -i $VIDEO{clip} -i $TMP/tmp_anim_u#.mp4 $BUILD/output.mp4');
  });

  it('prefers the most specific root when one contains another', () => {
    const nested = { tempDir: '/tmp', buildDir: '/tmp/work/build' };

    expect(normalizeCommand('-i /tmp/x.mp4 /tmp/work/build/o.mp4', nested)).toBe('-i $TMP/x.mp4 $BUILD/o.mp4');
  });

  it('is independent of execution order and machine roots', () => {
    const a = graphDigest(
      ['-i /home/a/build/1.mp4 /home/a/build/o1.mp4', '-i /home/a/build/2.mp4 /home/a/build/o2.mp4'],
      roots
    );
    const b = graphDigest(['-i /srv/b/2.mp4 /srv/b/o2.mp4', '-i /srv/b/1.mp4 /srv/b/o1.mp4'], { buildDir: '/srv/b' });

    expect(a.sha256).toBe(b.sha256);
  });
});
