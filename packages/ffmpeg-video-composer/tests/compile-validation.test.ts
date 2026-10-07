import { describe, it, expect, vi } from 'vitest';
import { compile } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

const buildDir = testBuildDir('compile-validation-test');

const baseConfig = () =>
  ({
    buildDir,
    assetsDir: buildDir,
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
  }) as unknown as ProjectConfig;

// global is .strict(): an unknown key is schema-invalid, but the engine itself would happily
// ignore it — exactly the class of error that used to slip through the Node path.
const invalidDescriptor = {
  global: { orientation: 'landscape', musicEnabled: false, definitelyNotAField: true },
  sections: [{ type: 'color_background', name: 'card', options: { duration: 1, backgroundColor: '#204060' } }],
} as unknown as TemplateDescriptor;

describe('compile() validation gate', () => {
  it('rejects a schema-invalid descriptor', async () => {
    const out = await compile(baseConfig(), invalidDescriptor);
    expect(out).toBeNull();
  });

  it('hands the validation summary to onError', async () => {
    const errors: Error[] = [];

    const out = await compile(baseConfig(), invalidDescriptor, { onError: (error) => errors.push(error) });

    expect(out).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Template validation failed');
    expect(errors[0].message).toContain('definitelyNotAField');
  });

  it('leaves the console to a caller that takes onError (no stack trace for a refused field)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const errors: Error[] = [];
    const fielded = {
      global: { fields: { HOLD: { type: 'number', default: 3 } } },
      sections: [
        { type: 'color_background', name: 'card', options: { duration: '{{ HOLD }}', backgroundColor: '#204060' } },
      ],
    } as unknown as TemplateDescriptor;

    try {
      const config = { ...baseConfig(), fields: { HOLD: 'slow' } } as ProjectConfig;

      expect(await compile(config, fielded, { onError: (error) => errors.push(error) })).toBeNull();
      expect(errors[0].message).toContain('HOLD');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('compiles the same descriptor when skipValidation is set', async () => {
    const config = { ...baseConfig(), skipValidation: true } as ProjectConfig;
    const out = await compile(config, invalidDescriptor);
    expect(out).not.toBeNull();
  }, 120000);
});
