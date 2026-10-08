// The WebAssembly the phone's HTML layer page carries inline, base64 (tsdown.config.ts writes it into the
// page): resvg draws, hb-subset pins variable fonts, hb shapes text for Satori.

export interface PageWasm {
  resvg: string;
  subset: string;
  shape: string;
}

/** The bytes of one of the page's inlined modules. */
export function pageWasm(name: keyof PageWasm): Uint8Array<ArrayBuffer> {
  const wasm = (globalThis as { __LECLAP_RASTER_WASM__?: PageWasm }).__LECLAP_RASTER_WASM__;

  if (!wasm) throw new Error('the page carries no WebAssembly');

  // atob is native here (a browser), much faster than the core's portable decoder on megabytes.
  const text = atob(wasm[name]);
  const bytes = new Uint8Array(text.length);

  for (let index = 0; index < text.length; index++) bytes[index] = text.codePointAt(index) ?? 0;

  return bytes;
}
