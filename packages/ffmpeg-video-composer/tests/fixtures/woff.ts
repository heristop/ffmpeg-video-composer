import { deflateSync } from 'node:zlib';

interface Table {
  tag: number;
  checksum: number;
  raw: Uint8Array;
  stored: Uint8Array;
}

// The sfnt's tables, each zlib-compressed when that makes it smaller (as a WOFF encoder does).
function packedTables(sfnt: Uint8Array): Table[] {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);

  return Array.from({ length: view.getUint16(4) }, (_, index) => {
    const at = 12 + index * 16;
    const raw = sfnt.subarray(view.getUint32(at + 8), view.getUint32(at + 8) + view.getUint32(at + 12));
    const packed = new Uint8Array(deflateSync(raw));

    return {
      tag: view.getUint32(at),
      checksum: view.getUint32(at + 4),
      raw,
      stored: packed.byteLength < raw.byteLength ? packed : raw,
    };
  });
}

/** A WOFF 1.0 file wrapping `sfnt` (the encoder side of woffToSfnt). */
export function ttfToWoff(sfnt: Uint8Array): Uint8Array {
  const tables = packedTables(sfnt);
  const size = tables.reduce((total, table) => total + ((table.stored.byteLength + 3) & ~3), 44 + tables.length * 20);
  const woff = new Uint8Array(size);
  const out = new DataView(woff.buffer);
  let offset = 44 + tables.length * 20;

  out.setUint32(0, 0x774f4646);
  out.setUint32(4, new DataView(sfnt.buffer, sfnt.byteOffset).getUint32(0));
  out.setUint32(8, size);
  out.setUint16(12, tables.length);
  out.setUint32(16, sfnt.byteLength);

  for (const [index, table] of tables.entries()) {
    const at = 44 + index * 20;

    out.setUint32(at, table.tag);
    out.setUint32(at + 4, offset);
    out.setUint32(at + 8, table.stored.byteLength);
    out.setUint32(at + 12, table.raw.byteLength);
    out.setUint32(at + 16, table.checksum);
    woff.set(table.stored, offset);
    offset += (table.stored.byteLength + 3) & ~3;
  }

  return woff;
}
