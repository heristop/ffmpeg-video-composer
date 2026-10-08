// Satori reads static faces only: its OpenType parser rejects a variable font's `fvar` table. Rubik,
// Oswald, Playfair Display and Roboto Mono ship as variable fonts, so each is instanced at the weights a
// layer uses with HarfBuzz's subsetter (hb-subset.wasm, `pin_axis_location` on `wght`): a static TrueType
// face per weight, byte-identical on every run.

/** The exports of harfbuzzjs's hb-subset.wasm this module calls. */
export interface HbSubset {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_keep_everything(input: number): void;
  hb_subset_input_pin_axis_location(input: number, face: number, tag: number, value: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_WRITABLE = 2;

function tableTags(font: Uint8Array): string[] {
  if (font.byteLength < 12) return [];

  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4);
  const tags: string[] = [];

  for (let index = 0; index < count && 16 + index * 16 <= font.byteLength; index++) {
    const at = 12 + index * 16;
    tags.push(String.fromCodePoint(font[at], font[at + 1], font[at + 2], font[at + 3]));
  }

  return tags;
}

/** Whether a TrueType/OpenType face is a variable font (it carries an `fvar` table). */
export function isVariableFont(font: Uint8Array): boolean {
  return tableTags(font).includes('fvar');
}

// An OpenType tag (four ASCII letters) as the 32-bit number HarfBuzz takes.
function tag(name: string): number {
  let value = 0;

  for (let index = 0; index < 4; index++) value = (value << 8) | (name.codePointAt(index) ?? 32);

  return value >>> 0;
}

/** The static face of a variable font at `weight` (pinned on `wght`; other axes stay at their default). */
export function instanceFont(hb: HbSubset, font: Uint8Array, weight: number): Uint8Array {
  const pointer = hb.malloc(font.byteLength);
  new Uint8Array(hb.memory.buffer).set(font, pointer);

  const blob = hb.hb_blob_create(pointer, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);

  const input = hb.hb_subset_input_create_or_fail();
  hb.hb_subset_input_keep_everything(input);
  hb.hb_subset_input_pin_axis_location(input, face, tag('wght'), weight);

  const subset = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);

  const result = hb.hb_face_reference_blob(subset);
  const offset = hb.hb_blob_get_data(result, 0);
  const length = hb.hb_blob_get_length(result);
  const instanced = new Uint8Array(hb.memory.buffer).slice(offset, offset + length);

  hb.hb_blob_destroy(result);
  hb.hb_face_destroy(subset);
  hb.hb_face_destroy(face);
  hb.free(pointer);

  if (length === 0) throw new Error(`could not instance the variable font at weight ${weight}`);

  return instanced;
}

/** A static face's own weight (OS/2 usWeightClass), 400 when the table is missing. */
export function faceWeight(font: Uint8Array): number {
  const tags = tableTags(font);
  const index = tags.indexOf('OS/2');

  if (index === -1) return 400;

  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const offset = view.getUint32(12 + index * 16 + 8);
  const weight = offset + 6 <= font.byteLength ? view.getUint16(offset + 4) : 400;

  return weight >= 100 && weight <= 900 ? Math.round(weight / 100) * 100 : 400;
}
