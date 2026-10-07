import { describe, expect, it } from 'vitest';
import { POLYFILL_BUILD, loadWebMcpPolyfill, polyfillRequested } from './polyfill';

describe('WebMCP polyfill gate', () => {
  it('needs both a build that allows it and a page that asks for it', () => {
    expect(polyfillRequested({ buildAllows: true, search: '?webmcp=polyfill', storedFlag: false })).toBe(true);
    expect(polyfillRequested({ buildAllows: true, search: '?x=1&webmcp=polyfill', storedFlag: false })).toBe(true);
    expect(polyfillRequested({ buildAllows: true, search: '', storedFlag: true })).toBe(true);
    expect(polyfillRequested({ buildAllows: true, search: '?webmcp=native', storedFlag: false })).toBe(false);
    expect(polyfillRequested({ buildAllows: false, search: '?webmcp=polyfill', storedFlag: true })).toBe(false);
  });

  it('is allowed in dev builds (vitest runs as one)', () => {
    expect(POLYFILL_BUILD).toBe(true);
  });

  it('does nothing outside a browser document', async () => {
    // The polyfill installs nothing without window/document; loading it still resolves.
    expect(await loadWebMcpPolyfill()).toBe(true);
    expect((globalThis as { document?: unknown }).document).toBeUndefined();
  });
});
