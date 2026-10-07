// The files an FFmpeg command reads, and their digests: `-i` sources and the files named inside filter
// arguments (drawtext `fontfile=`/`textfile=`, `lut3d=file=`, `movie=filename=`). Shared by the section
// cache key and the plan hash. Node only.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseCommand } from '../platform/ffmpeg/parse-command';

// Engine paths never hold whitespace, quotes, colons or commas (core/arg-guard.ts), so a value ends at the
// first of them whether it is quoted or not.
const FILE_OPTION = /(?:fontfile|textfile|filename|file)='?([^':,\s\]]+)/g;

export function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Files named by filter options inside one argument (e.g. drawtext `fontfile='…'`). */
export function filterFiles(arg: string): string[] {
  return [...arg.matchAll(FILE_OPTION)].map((match) => match[1]).filter(isFile);
}

/** Every existing file the command reads (never its output, the last argument), absolute and sorted. */
export function commandInputFiles(command: string): string[] {
  const args = parseCommand(command);
  const found = new Set<string>();

  for (const [index, arg] of args.slice(0, -1).entries()) {
    if (args.at(index - 1) === '-i' && isFile(arg)) found.add(path.resolve(arg));

    for (const file of filterFiles(arg)) found.add(path.resolve(file));
  }

  return [...found].sort();
}

// Digests keyed by path + size + mtime: a render digests the same fonts and clips many times.
const digests = new Map<string, Promise<string>>();

function streamDigest(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => {
        hash.update(chunk);
      })
      .on('error', reject)
      .on('end', () => {
        resolve(hash.digest('hex'));
      });
  });
}

/** SHA-256 of a file's bytes (hex), memoized while the file is unchanged. */
export function fileDigest(file: string): Promise<string> {
  const stat = fs.statSync(file);
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  const cached = digests.get(key);

  if (cached) return cached;

  const pending = streamDigest(file);
  digests.set(key, pending);
  pending.catch(() => digests.delete(key));

  return pending;
}
