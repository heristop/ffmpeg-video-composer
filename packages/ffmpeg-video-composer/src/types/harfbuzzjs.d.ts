// The two CommonJS files of harfbuzzjs the browser shaper shim starts HarfBuzz from (the package ships no
// types). Only what the shim touches; Satori uses the rest of the API itself.
declare module 'harfbuzzjs/hb.js' {
  export default function createHarfBuzz(module?: { wasmBinary?: BufferSource }): Promise<object>;
}

declare module 'harfbuzzjs/hbjs.js' {
  export default function hbjs(instance: object): { createBlob: (data: Uint8Array) => unknown };
}
