import { describe, it, expect, vi } from 'vitest';
import FFmpegDeviceAdapter, { type NativeEngine } from '../src/platform/ffmpeg/FFmpegDeviceAdapter';
import { parseCommand } from '../src/platform/ffmpeg/parse-command';

describe('parseCommand', () => {
  it('splits args and keeps a quoted filtergraph (incl. inner single quotes) intact', () => {
    const cmd = `-y -i in.mp4 -filter_complex "drawtext=text='Hi There':x=10" out.mp4`;
    expect(parseCommand(cmd)).toEqual([
      '-y',
      '-i',
      'in.mp4',
      '-filter_complex',
      "drawtext=text='Hi There':x=10",
      'out.mp4',
    ]);
  });

  it('throws on an unterminated quote instead of dropping the final token', () => {
    expect(() => parseCommand('-i in.mp4 "out.mp4')).toThrow(/Unterminated quote/);
  });
});

function engineWith(overrides: Partial<NativeEngine>): NativeEngine {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, log: '' }),
    probe: vi.fn().mockResolvedValue({ code: 0, output: '{"streams":[]}' }),
    ...overrides,
  };
}

describe('FFmpegDeviceAdapter', () => {
  it('execute() parses the command to argv and runs it natively', async () => {
    const run = vi.fn().mockResolvedValue({ code: 0, log: '' });
    const adapter = new FFmpegDeviceAdapter(engineWith({ run }));

    const result = await adapter.execute('-y -i a.mp4 -vf scale=1280:720 out.mp4');

    expect(result).toEqual({ rc: 0 });
    expect(run).toHaveBeenCalledWith(['-nostdin', '-y', '-i', 'a.mp4', '-vf', 'scale=1280:720', 'out.mp4']);
  });

  it('execute() always runs with -nostdin, once', async () => {
    // The engine runs fftools inside the app process: without -nostdin, ffmpeg polls the app's stdin
    // and installs a SIGQUIT handler there, so a SIGQUIT sent to the app (Android's ANR stack dump)
    // sets the shutdown flag and a finished encode exits 255.
    const run = vi.fn().mockResolvedValue({ code: 0, log: '' });
    const adapter = new FFmpegDeviceAdapter(engineWith({ run }));

    await adapter.execute('-y -i a.mp4 out.mp4');
    await adapter.execute('-nostdin -y -i a.mp4 out.mp4');

    expect(run).toHaveBeenNthCalledWith(1, ['-nostdin', '-y', '-i', 'a.mp4', 'out.mp4']);
    expect(run).toHaveBeenNthCalledWith(2, ['-nostdin', '-y', '-i', 'a.mp4', 'out.mp4']);
  });

  it('execute() throws with the captured log when the engine returns a non-zero exit code', async () => {
    const adapter = new FFmpegDeviceAdapter(
      engineWith({ run: vi.fn().mockResolvedValue({ code: 1, log: 'Error: bad filter' }) })
    );

    await expect(adapter.execute('-y -i a.mp4 out.mp4')).rejects.toThrow(/bad filter/);
  });

  it('getInfos() maps ffprobe JSON to FFMpegInfos', async () => {
    const probeJson = JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', duration: '8.00' },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000' },
      ],
    });
    const probe = vi.fn().mockResolvedValue({ code: 0, output: probeJson });
    const adapter = new FFmpegDeviceAdapter(engineWith({ probe }));

    const infos = await adapter.getInfos('clip.mp4');

    expect(infos).toEqual({ duration: 8, videoCodec: 'h264', audioCodec: 'aac', sampleRate: 48000 });
    expect(probe).toHaveBeenCalledWith([
      '-hide_banner',
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_streams',
      'clip.mp4',
    ]);
  });

  it('getInfos() tolerates a non-JSON banner line printed on stdout ahead of the JSON', async () => {
    // The embedded ffprobe can emit a version/banner line on stdout before the JSON document, which
    // made a strict JSON.parse fail with "Unexpected character: f" (the "ffprobe…" line).
    const noisy = `ffprobe version n8.0\n${JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', duration: '2.40' }],
    })}\n`;
    const adapter = new FFmpegDeviceAdapter(
      engineWith({ probe: vi.fn().mockResolvedValue({ code: 0, output: noisy }) })
    );

    const infos = await adapter.getInfos('intro_output.mp4');

    expect(infos).toEqual({ duration: 2.4, videoCodec: 'h264', audioCodec: null, sampleRate: null });
  });

  it('getInfos() degrades to null infos (no throw) when the probe output has no JSON — a clip whose ffprobe output is unparseable (some camera-recorded MP4s) then falls back to the declared duration instead of aborting the compile', async () => {
    const adapter = new FFmpegDeviceAdapter(
      engineWith({ probe: vi.fn().mockResolvedValue({ code: 0, output: 'failed to open file' }) })
    );

    const infos = await adapter.getInfos('x.mp4');

    expect(infos.duration).toBeNull();
    expect(infos.videoCodec).toBeNull();
    expect(infos.audioCodec).toBeNull();
  });

  it('getInfos() throws on a non-zero probe', async () => {
    const adapter = new FFmpegDeviceAdapter(engineWith({ probe: vi.fn().mockResolvedValue({ code: 1, output: '' }) }));

    await expect(adapter.getInfos('x.mp4')).rejects.toThrow(/FFprobe analysis failed/);
  });
});
