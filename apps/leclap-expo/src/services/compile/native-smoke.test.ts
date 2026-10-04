import { TemplateDescriptorSchema } from 'ffmpeg-video-composer/src/schemas/template.schemas.ts';
import { findFont } from 'ffmpeg-video-composer/src/core/fonts.ts';
import { compileOnDevice } from './compileOnDevice';
import * as Leclap from '@/modules/leclap-ffmpeg';
import { NATIVE_SMOKE_TEMPLATE, runNativeSmoke } from './native-smoke';

declare const jest: {
  mock(moduleName: string, factory: () => unknown): void;
  fn(): unknown;
};
type Mock = {
  mockReset(): void;
  mockResolvedValue(value: unknown): void;
};
jest.mock('./compileOnDevice', () => ({ compileOnDevice: jest.fn() }));
jest.mock('@/modules/leclap-ffmpeg', () => ({ probe: jest.fn() }));
const compile = compileOnDevice as unknown as Mock;
const probe = Leclap.probe as unknown as Mock;
const validOutput = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '30/1' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '3.024' },
};
beforeEach(() => {
  compile.mockReset();
  probe.mockReset();
  compile.mockResolvedValue({ success: true, outputUri: 'file:///cache/out.mp4' });
  probe.mockResolvedValue({ code: 0, output: JSON.stringify(validOutput) });
});

describe('native JSON compilation smoke', () => {
  it('uses a valid bounded descriptor with native text, footage, motion and music', () => {
    expect(() => TemplateDescriptorSchema.parse(NATIVE_SMOKE_TEMPLATE)).not.toThrow();
    for (const section of NATIVE_SMOKE_TEMPLATE.sections) {
      const fonts = [
        section.caption?.font,
        section.titleCard?.headlineStyle.font,
        section.titleCard?.subtitleStyle.font,
      ];
      for (const font of fonts.filter(Boolean)) expect(findFont(font!)).toBeDefined();
    }
  });
  it('runs and probes two complete compositions to exercise engine re-entrancy', async () => {
    expect(await runNativeSmoke('file:///cache/input.mp4', () => {})).toBe('file:///cache/out.mp4');
    expect(compileOnDevice).toHaveBeenCalledTimes(2);
    expect(compileOnDevice).toHaveBeenCalledWith(
      NATIVE_SMOKE_TEMPLATE,
      { footage: { path: 'file:///cache/input.mp4', orientation: 'landscape' } },
      { qualityTier: 'draft' }
    );
    expect(Leclap.probe).toHaveBeenCalledTimes(2);
    expect(Leclap.probe).toHaveBeenCalledWith([
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      '/cache/out.mp4',
    ]);
  });
  it('stops on an actual compilation failure instead of accepting a previous output', async () => {
    compile.mockResolvedValue({ success: false, error: 'native encoder failed' });
    await expect(runNativeSmoke('file:///input.mp4', () => {})).rejects.toThrow('native encoder failed');
    expect(Leclap.probe).not.toHaveBeenCalled();
  });
  it('rejects a nonzero probe result', async () => {
    probe.mockResolvedValue({ code: 1, output: 'invalid MP4' });
    await expect(runNativeSmoke('file:///input.mp4', () => {})).rejects.toThrow('invalid MP4');
    expect(compileOnDevice).toHaveBeenCalledTimes(1);
  });
  it('rejects missing audio', async () => {
    probe.mockResolvedValue({ code: 0, output: JSON.stringify({ ...validOutput, streams: [validOutput.streams[0]] }) });
    await expect(runNativeSmoke('file:///input.mp4', () => {})).rejects.toThrow('Unexpected native output');
  });
  it.each([
    { ...validOutput, streams: [{ ...validOutput.streams[0], width: 640 }, validOutput.streams[1]] },
    { ...validOutput, streams: [{ ...validOutput.streams[0], r_frame_rate: '24/1' }, validOutput.streams[1]] },
    { ...validOutput, streams: [validOutput.streams[0], { ...validOutput.streams[1], codec_name: 'mp3' }] },
    { ...validOutput, format: { duration: 'NaN' } },
    { ...validOutput, format: { duration: '30' } },
  ])('rejects an output outside the expected native video contract (%#)', async (output) => {
    probe.mockResolvedValue({ code: 0, output: JSON.stringify(output) });
    await expect(runNativeSmoke('file:///input.mp4', () => {})).rejects.toThrow('Unexpected native output');
    expect(compileOnDevice).toHaveBeenCalledTimes(1);
  });
});
