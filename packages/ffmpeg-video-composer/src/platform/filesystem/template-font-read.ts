// How the Node adapter reads a template font (`global.fonts[].src` that is not a data URI): from the given
// roots only (the font dirs, then the assets dir), never the temp or build dirs other staged media may come
// from, never the network. A relative src is joined to each root; an absolute one, and any symlink, must
// resolve inside one. The first root holding a regular file wins. The size is checked before reading.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TEMPLATE_FONT_MAX_BYTES, TemplateFontError } from '../../core/html/template-fonts';

async function fileWithin(root: string, src: string): Promise<{ file: string; size: number } | null> {
  const [realRoot, real] = await Promise.all([
    fs.realpath(root).catch(() => ''),
    fs.realpath(path.isAbsolute(src) ? src : path.resolve(root, src)).catch(() => ''),
  ]);

  if (realRoot === '' || real === '' || (real !== realRoot && !real.startsWith(realRoot + path.sep))) return null;

  const info = await fs.stat(real);

  return info.isFile() ? { file: real, size: info.size } : null;
}

/** The font's bytes from the first root that holds it, or null when none does. */
export async function readTemplateFontWithin(roots: readonly string[], src: string): Promise<Uint8Array | null> {
  const found = (await Promise.all(roots.map((root) => fileWithin(root, src)))).find((match) => match !== null);

  if (!found) return null;

  if (found.size > TEMPLATE_FONT_MAX_BYTES) {
    const megabytes = TEMPLATE_FONT_MAX_BYTES / (1024 * 1024);

    throw new TemplateFontError(
      'font_too_large',
      `is ${Math.ceil(found.size / (1024 * 1024))} MB, over the ${megabytes} MB limit for a template font: subset it to the scripts the template uses`
    );
  }

  return new Uint8Array(await fs.readFile(found.file));
}
