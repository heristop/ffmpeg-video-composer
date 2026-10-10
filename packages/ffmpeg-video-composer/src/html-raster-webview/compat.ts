// Built-ins the page's dependencies call that the oldest supported WebView lacks (Android System WebView 87,
// iOS 16.4: docs/on-device-compilation.md#html-layers). Imported first by the page, so it runs before them.
// Each is defined only where missing, non-enumerable like the native one, so a current WebView keeps its own.
// tests/html-raster-webview-page.test.ts renders the golden card without the newer built-ins.

function polyfill(owner: object, name: string, value: unknown): void {
  if (name in owner) return;

  Object.defineProperty(owner, name, { value, writable: true, configurable: true, enumerable: false });
}

// Satori reads gradient stops with `stops.at(-1)` (Chrome 92).
polyfill(Array.prototype, 'at', function at<T>(this: T[], index: number): T | undefined {
  const offset = Math.trunc(index) || 0;

  return this[offset < 0 ? this.length + offset : offset];
});
