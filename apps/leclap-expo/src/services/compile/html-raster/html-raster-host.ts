// Draws the engine's HTML layers on the phone. Hermes has no WebAssembly, so each layer goes to a hidden
// react-native-webview running the engine's page (dist/html-rasteriser.html: the same Satori + resvg +
// HarfBuzz pipeline as Node, same bytes). This host is the rasteriser the engine calls; <HtmlRasterView />
// mounts the WebView while the host is active and hands its messages back here.
//
// One page per render: the first layer mounts it and waits for its `ready`, later layers reuse it (fonts
// travel once per page), and release() after the compile tears it down.

import {
  HTML_RENDERER_VERSION,
  createRasterSession,
  readRasterReply,
  type HtmlRaster,
  type HtmlRasteriser,
  type HtmlRasterRequest,
  type RasterPageReply,
  type RasterSession,
} from 'ffmpeg-video-composer/reactnative';

/** Where render messages go: the mounted WebView. */
export interface RasterPageView {
  post(text: string): void;
}

export interface LayerTiming {
  width: number;
  height: number;
  /** Request to PNG, as the engine waits for it (bridge, base64 and the page's drawing). */
  ms: number;
  /** The drawing alone, measured in the page. */
  pageMs: number;
}

export interface HtmlRasterHost {
  readonly rasteriser: HtmlRasteriser;
  /** Whether a render needs the page mounted. */
  isActive: () => boolean;
  /** Mounts the page now, so it loads while the render stages its other assets. */
  prepare: () => void;
  subscribe: (listener: () => void) => () => void;
  attach: (view: RasterPageView | null) => void;
  /** A message the page posted. */
  receive: (text: string) => void;
  /** The WebView's process died: pending layers fail, the next one mounts a new page. */
  crashed: (reason: string) => void;
  /** The render is over: unmount the page. */
  release: () => void;
  /** Time per layer drawn since the host was created, oldest first. */
  timings: () => LayerTiming[];
  /** How long the last page took from mount to `ready`, or null before any. */
  pageLoadMs: () => number | null;
  /** Calls `observer` with each layer drawn from now on (the device check hashes them); returns a stop. */
  observe: (observer: LayerObserver) => () => void;
}

export type LayerObserver = (request: HtmlRasterRequest, raster: HtmlRaster) => void;

export interface HtmlRasterHostOptions {
  readyTimeoutMs?: number;
  layerTimeoutMs?: number;
}

interface Waiter<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function waiter<T>(timeoutMs: number, timeoutMessage: string): Waiter<T> {
  let settle: { resolve(value: T): void; reject(error: Error): void } | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const timer = setTimeout(() => settle?.reject(new Error(timeoutMessage)), timeoutMs);
  const done = (): void => {
    clearTimeout(timer);
  };

  // Nobody may be awaiting yet when it fails (the page can die before the first layer is sent).
  promise.catch(() => null);

  return {
    promise,
    resolve: (value) => {
      done();
      settle?.resolve(value);
    },
    reject: (error) => {
      done();
      settle?.reject(error);
    },
  };
}

interface PageSession {
  messages: RasterSession;
  ready: Waiter<void>;
  mountedAt: number;
  pending: Map<number, Waiter<RasterPageReply>>;
}

const LAYER_LIMIT = 200;

function parseReply(text: string): RasterPageReply | null {
  try {
    return JSON.parse(text) as RasterPageReply;
  } catch {
    return null;
  }
}

export function createHtmlRasterHost(options: HtmlRasterHostOptions = {}): HtmlRasterHost {
  const readyTimeoutMs = options.readyTimeoutMs ?? 60_000;
  const layerTimeoutMs = options.layerTimeoutMs ?? 30_000;
  const listeners = new Set<() => void>();
  const observers = new Set<LayerObserver>();
  const timings: LayerTiming[] = [];
  let session: PageSession | null = null;
  let view: RasterPageView | null = null;
  let loadMs: number | null = null;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  function open(): PageSession {
    if (session) return session;

    session = {
      messages: createRasterSession(),
      ready: waiter<void>(readyTimeoutMs, 'the HTML layer page did not load'),
      mountedAt: Date.now(),
      pending: new Map(),
    };
    notify();

    return session;
  }

  function close(error: Error): void {
    if (!session) return;

    session.ready.reject(error);

    for (const pending of session.pending.values()) pending.reject(error);
    session = null;
    view = null;
    notify();
  }

  function receive(text: string): void {
    const reply = parseReply(text);

    if (!session || !reply) return;

    if (reply.type === 'ready' && reply.version !== HTML_RENDERER_VERSION) {
      session.ready.reject(
        new Error(`HTML layer page draws with ${reply.version}, the engine expects ${HTML_RENDERER_VERSION}`)
      );

      return;
    }

    if (reply.type === 'ready') {
      loadMs = Date.now() - session.mountedAt;
      console.info(`[html-raster] page ready in ${loadMs} ms (${reply.version})`);
      session.ready.resolve();

      return;
    }

    const id = reply.id;

    if (id === undefined) {
      session.ready.reject(new Error(`HTML layer page: ${reply.type === 'failed' ? reply.message : 'no id'}`));

      return;
    }

    session.pending.get(id)?.resolve(reply);
    session.pending.delete(id);
  }

  // The page draws one layer at a time anyway (one JS thread); queueing here keeps each timing its own.
  let queue: Promise<unknown> = Promise.resolve();

  function render(request: HtmlRasterRequest): Promise<HtmlRaster> {
    const next = queue.then(async () => draw(request));

    queue = next.catch(() => null);

    return next;
  }

  async function draw(request: HtmlRasterRequest): Promise<HtmlRaster> {
    const current = open();

    await current.ready.promise;

    const started = Date.now();
    const message = current.messages.message(request);
    const pending = waiter<RasterPageReply>(layerTimeoutMs, 'the HTML layer page did not answer');

    current.pending.set(message.id, pending);
    view?.post(JSON.stringify(message));

    const reply = await pending.promise;
    const raster = readRasterReply(reply);
    const timing = {
      width: request.width,
      height: request.height,
      ms: Date.now() - started,
      pageMs: reply.type === 'rendered' ? reply.ms : 0,
    };

    timings.push(timing);

    if (timings.length > LAYER_LIMIT) timings.shift();
    console.info(`[html-raster] ${timing.width}×${timing.height} layer in ${timing.ms} ms (page ${timing.pageMs} ms)`);

    for (const observer of observers) observer(request, raster);

    return raster;
  }

  return {
    rasteriser: { version: HTML_RENDERER_VERSION, render },
    isActive: () => session !== null,
    prepare: () => {
      open();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    attach: (next) => {
      view = next;
    },
    receive,
    crashed: (reason) => {
      close(new Error(`HTML layer page: ${reason}`));
    },
    release: () => {
      close(new Error('HTML layer page: released'));
    },
    timings: () => [...timings],
    pageLoadMs: () => loadMs,
    observe: (observer) => {
      observers.add(observer);

      return () => {
        observers.delete(observer);
      };
    },
  };
}

/** The app's one host: the compile registers its rasteriser, <HtmlRasterView /> mounts its page. */
export const htmlRasterHost = createHtmlRasterHost();
