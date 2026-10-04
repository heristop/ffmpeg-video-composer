import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function hashFile(file: string, hash = createHash('sha256')) {
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }

  return hash;
}

export async function hashFiles(directory: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(dir: string): Promise<void> {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    // Chaining preserves sorted byte order without buffering entire asset files.
    await entries.reduce(async (previous, entry) => {
      await previous;
      const file = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await visit(file);

        return;
      }

      if (!entry.isFile()) throw new Error('effect_bundle_invalid: non-regular bundle file.');
      hash.update(path.relative(directory, file)).update('\0');
      await hashFile(file, hash);
      hash.update('\0');
    }, Promise.resolve());
  }
  await visit(directory);

  return hash.digest('hex');
}
