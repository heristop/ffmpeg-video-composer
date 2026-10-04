import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';

const initialized = vi.hoisted(() => vi.fn());
vi.mock('@/platform/filesystem/FilesystemExpoAdapter', () => ({
  default: class {
    constructor() {
      initialized('filesystem');
    }
  },
}));
vi.mock('@/platform/ffmpeg/FFmpegDeviceAdapter', () => ({
  default: class {
    constructor() {
      initialized('ffmpeg');
    }
  },
}));

import { compileReactNative } from '@/reactnative';

describe('React Native unresolved effect guard', () => {
  it('rejects before initializing native adapters or calling the engine', async () => {
    const engine = { run: vi.fn(), probe: vi.fn(), cancel: vi.fn() };
    const effect = {
      type: 'effect',
      name: 'intro',
      effect: { id: 'leclap.title-reveal', version: '1.0.0', props: {}, assets: {} },
      options: { duration: 2 },
    };
    await expect(compileReactNative({}, { sections: [effect] }, engine)).rejects.toThrow(
      /effect_backend_unavailable.*intro/
    );
    expect(initialized).not.toHaveBeenCalled();
    expect(engine.run).not.toHaveBeenCalled();
    expect(engine.probe).not.toHaveBeenCalled();
  });
});
