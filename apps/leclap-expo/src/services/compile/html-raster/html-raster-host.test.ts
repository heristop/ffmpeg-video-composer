import { createHtmlRasterHost, type HtmlRasterHost } from './html-raster-host';
import type { HtmlRasterRequest } from 'ffmpeg-video-composer/reactnative';

declare const jest: {
  mock(moduleName: string, factory: () => unknown): void;
  requireActual<T>(moduleName: string): T;
};

// The real message encoding, from the engine's sources (the RN dist is ESM, which this jest config doesn't load).
jest.mock('ffmpeg-video-composer/reactnative', () => ({
  ...jest.requireActual<object>('ffmpeg-video-composer/src/core/html/raster-messages.ts'),
  HTML_RENDERER_VERSION: 'satori@test',
}));

interface Sent {
  type: string;
  id: number;
  width: number;
  fonts: { key: string; data?: string }[];
}

const REQUEST: HtmlRasterRequest = {
  element: { type: 'div', props: { style: {} } },
  width: 120,
  height: 40,
  density: 2,
  fonts: [{ family: 'Rubik', file: 'Rubik.ttf', weights: [400], data: Uint8Array.from([1, 2, 3]) }],
};

// A page that answers each render with a fixed PNG, like the WebView would once loaded.
function fakePage(host: HtmlRasterHost): Sent[] {
  const sent: Sent[] = [];

  host.attach({
    post: (text) => {
      const message = JSON.parse(text) as Sent;
      sent.push(message);
      setTimeout(() => {
        host.receive(JSON.stringify({ type: 'rendered', id: message.id, png: 'iVBO', contentHeight: 30, ms: 7 }));
      }, 0);
    },
  });

  return sent;
}

function mountOnActivate(host: HtmlRasterHost, onMount: () => void): void {
  host.subscribe(() => {
    if (host.isActive()) setTimeout(onMount, 0);
  });
}

describe('HTML raster host', () => {
  it('stays unmounted until a layer needs it', () => {
    const host = createHtmlRasterHost();

    expect(host.isActive()).toBe(false);
  });

  it('mounts the page ahead of the first layer when asked to prepare', () => {
    const host = createHtmlRasterHost();

    host.prepare();

    expect(host.isActive()).toBe(true);
  });

  it('mounts the page on the first layer, waits for it, and returns the drawn PNG', async () => {
    const host = createHtmlRasterHost();
    let sent: Sent[] = [];

    mountOnActivate(host, () => {
      sent = fakePage(host);
      host.receive(JSON.stringify({ type: 'ready', version: 'satori@test' }));
    });

    const raster = await host.rasteriser.render(REQUEST);

    expect(host.isActive()).toBe(true);
    expect(Array.from(raster.png)).toEqual([0x89, 0x50, 0x4e]);
    expect(raster.contentHeight).toBe(30);
    expect(sent).toHaveLength(1);
  });

  it('reuses the page across layers and sends each font once', async () => {
    const host = createHtmlRasterHost();
    let sent: Sent[] = [];
    let mounts = 0;

    mountOnActivate(host, () => {
      mounts += 1;
      sent = fakePage(host);
      host.receive(JSON.stringify({ type: 'ready', version: 'satori@test' }));
    });

    await host.rasteriser.render(REQUEST);
    await host.rasteriser.render(REQUEST);

    expect(mounts).toBe(1);
    expect(sent.map((message) => message.fonts[0].data)).toEqual(['AQID', undefined]);
    expect(host.timings()).toEqual([
      expect.objectContaining({ width: 120, height: 40, pageMs: 7 }),
      expect.objectContaining({ width: 120, height: 40, pageMs: 7 }),
    ]);
  });

  it('tears the page down on release and starts a fresh session on the next render', async () => {
    const host = createHtmlRasterHost();
    let sent: Sent[] = [];

    mountOnActivate(host, () => {
      sent = fakePage(host);
      host.receive(JSON.stringify({ type: 'ready', version: 'satori@test' }));
    });

    await host.rasteriser.render(REQUEST);
    host.release();

    expect(host.isActive()).toBe(false);

    await host.rasteriser.render(REQUEST);

    expect(sent[0].fonts[0].data).toBe('AQID');
  });

  it('sends one layer at a time, so each timing is its own', async () => {
    const host = createHtmlRasterHost();
    const events: string[] = [];

    mountOnActivate(host, () => {
      host.attach({
        post: (text) => {
          const { id } = JSON.parse(text) as Sent;
          events.push(`sent ${id}`);
          setTimeout(() => {
            events.push(`drawn ${id}`);
            host.receive(JSON.stringify({ type: 'rendered', id, png: 'iVBO', contentHeight: 30, ms: 7 }));
          }, 5);
        },
      });
      host.receive(JSON.stringify({ type: 'ready', version: 'satori@test' }));
    });

    await Promise.all([host.rasteriser.render(REQUEST), host.rasteriser.render(REQUEST)]);

    expect(events).toEqual(['sent 1', 'drawn 1', 'sent 2', 'drawn 2']);
  });

  it('shows each drawn layer to its observers until they stop', async () => {
    const host = createHtmlRasterHost();
    const seen: number[] = [];

    mountOnActivate(host, () => {
      fakePage(host);
      host.receive(JSON.stringify({ type: 'ready', version: 'satori@test' }));
    });

    const stop = host.observe((request, raster) => seen.push(request.width, raster.png.length));

    await host.rasteriser.render(REQUEST);
    stop();
    await host.rasteriser.render(REQUEST);

    expect(seen).toEqual([120, 3]);
  });

  it('fails the layer with the page error', async () => {
    const host = createHtmlRasterHost();

    mountOnActivate(host, () => {
      host.attach({
        post: (text) => {
          const { id } = JSON.parse(text) as Sent;
          host.receive(JSON.stringify({ type: 'failed', id, message: 'font Rubik.ttf was not sent' }));
        },
      });
      host.receive(JSON.stringify({ type: 'ready', version: 'satori@test' }));
    });

    await expect(host.rasteriser.render(REQUEST)).rejects.toThrow('font Rubik.ttf was not sent');
  });

  it('fails when the page cannot load its engines', async () => {
    const host = createHtmlRasterHost();

    mountOnActivate(host, () => {
      host.receive(JSON.stringify({ type: 'failed', message: 'no WebAssembly' }));
    });

    await expect(host.rasteriser.render(REQUEST)).rejects.toThrow(/no WebAssembly/);
  });

  it('refuses a page built against other engine versions', async () => {
    const host = createHtmlRasterHost();

    mountOnActivate(host, () => {
      host.receive(JSON.stringify({ type: 'ready', version: 'satori@old' }));
    });

    await expect(host.rasteriser.render(REQUEST)).rejects.toThrow(/satori@old.*satori@test/);
  });

  it('names the engine versions in its cache key', () => {
    expect(createHtmlRasterHost().rasteriser.version).toBe('satori@test');
  });

  it('fails when the page never loads', async () => {
    const host = createHtmlRasterHost({ readyTimeoutMs: 10 });

    await expect(host.rasteriser.render(REQUEST)).rejects.toThrow(/did not load/);
  });

  it('fails the pending layer and remounts after the WebView process died', async () => {
    const host = createHtmlRasterHost();
    let mounts = 0;

    mountOnActivate(host, () => {
      mounts += 1;

      if (mounts === 1) {
        host.attach({ post: () => setTimeout(() => host.crashed('render process gone'), 0) });
        host.receive(JSON.stringify({ type: 'ready', version: 'satori@test' }));

        return;
      }

      fakePage(host);
      host.receive(JSON.stringify({ type: 'ready', version: 'satori@test' }));
    });

    await expect(host.rasteriser.render(REQUEST)).rejects.toThrow(/render process gone/);
    await expect(host.rasteriser.render(REQUEST)).resolves.toMatchObject({ contentHeight: 30 });
    expect(mounts).toBe(2);
  });
});
