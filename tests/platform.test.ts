import 'reflect-metadata';
import PlatformBridge from '@/platform/PlatformBridge';
import FFmpegNodeAdapter from '@/platform/ffmpeg/FFmpegNodeAdapter';
import MusicNodeAdapter from '@/platform/ffmpeg/MusicNodeAdapter';
import FilesystemNodeAdapter from '@/platform/filesystem/FilesystemNodeAdapter';

describe('PlatformBridge', () => {
  let platformBridge: PlatformBridge;

  beforeEach(() => {
    platformBridge = new PlatformBridge();
  });

  describe('create', () => {
    it('should create an FFmpegNodeAdapter when ffmpeg adapter is requested', () => {
      const adapter = platformBridge.create('ffmpeg');
      expect(adapter).toBeInstanceOf(FFmpegNodeAdapter);
    });

    it('should create a FilesystemNodeAdapter when filesystem adapter is requested', () => {
      const adapter = platformBridge.create('filesystem');
      expect(adapter).toBeInstanceOf(FilesystemNodeAdapter);
    });

    it('should create a MusicNodeAdapter when music adapter is requested', () => {
      const adapter = platformBridge.create('music');
      expect(adapter).toBeInstanceOf(MusicNodeAdapter);
    });

    it('should throw a TypeError for an unknown adapter', () => {
      expect(() => {
        platformBridge.create('unknown');
      }).toThrow(TypeError);
    });
  });

  describe('isNodeEnvironment', () => {
    it('should return true in a Node environment', () => {
      // This test assumes it is run in a Node environment
      expect(platformBridge.isNodeEnvironment()).toBe(true);
    });
  });
});
