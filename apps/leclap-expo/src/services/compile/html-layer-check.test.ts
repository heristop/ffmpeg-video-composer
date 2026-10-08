import { compileOnDevice } from './compileOnDevice';
import { htmlRasterHost } from './html-raster/html-raster-host';
import { HTML_CARD_GOLDENS, runHtmlLayerCheck } from './html-layer-check';

declare const jest: {
  mock(moduleName: string, factory: () => unknown): void;
  fn(): unknown;
};

type Section = { options: { pictureUrl: string } };
type Mock = { mockImplementation(impl: (...args: never[]) => unknown): void };

jest.mock('./compileOnDevice', () => ({ compileOnDevice: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', deleteAsync: jest.fn() }));
jest.mock('ffmpeg-video-composer/src/core/determinism/sha256.ts', () => ({
  sha256Hex: (bytes: Uint8Array) => (bytes[0] === 1 ? HTML_CARD_GOLDENS['608×264'] : 'other'),
}));

const observers: ((request: { width: number; height: number }, raster: { png: Uint8Array }) => void)[] = [];

jest.mock('./html-raster/html-raster-host', () => ({
  htmlRasterHost: {
    observe: (observer: (typeof observers)[number]) => {
      observers.push(observer);

      return () => observers.splice(observers.indexOf(observer), 1);
    },
    timings: jest.fn(),
    pageLoadMs: () => 240,
  },
}));

describe('HTML layer device check', () => {
  it('compiles the html-card sample and tells which layers match Node byte for byte', async () => {
    const earlier = { width: 10, height: 10, ms: 1, pageMs: 1 };
    let drawn = [earlier];

    (htmlRasterHost.timings as unknown as Mock).mockImplementation(() => drawn);
    (compileOnDevice as unknown as Mock).mockImplementation(async (descriptor: { sections: Section[] }) => {
      expect(descriptor.sections.map((section) => section.options.pictureUrl)).toEqual([
        '/assets/backgrounds/sage-wall.jpg',
        '/assets/backgrounds/cafe-table.jpg',
        '/assets/backgrounds/warm-bokeh.jpg',
      ]);

      drawn = [
        earlier,
        { width: 608, height: 264, ms: 180, pageMs: 120 },
        { width: 300, height: 120, ms: 60, pageMs: 30 },
      ];

      for (const observer of observers) {
        observer({ width: 608, height: 264 }, { png: Uint8Array.from([1]) });
        observer({ width: 300, height: 120 }, { png: Uint8Array.from([2]) });
      }

      return { success: true, outputUri: 'file:///cache/card.mp4' };
    });
    const lines: string[] = [];

    const check = await runHtmlLayerCheck((line) => lines.push(line));

    expect(check).toEqual({
      outputUri: 'file:///cache/card.mp4',
      pageLoadMs: 240,
      layers: [
        { size: '608×264', ms: 180, pageMs: 120, golden: true },
        { size: '300×120', ms: 60, pageMs: 30, golden: false },
      ],
    });
    expect(lines.at(-1)).toContain('differs from Node');
    expect(observers).toHaveLength(0);
  });
});
