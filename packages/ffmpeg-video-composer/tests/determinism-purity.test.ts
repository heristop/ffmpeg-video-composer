import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// D1 (docs/plans/motion-system.md): compiling a template is a pure function of the template, its
// assets and the platform profile. The modules that turn a descriptor into FFmpeg commands may not read
// the clock or an unseeded random source. Scratch-file naming goes through utils/temp-suffix.ts, the
// one sanctioned clock read, which the render manifest normalizes away.

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../src');
const COMPILE_PATH_DIRS = ['core', 'director', 'editor', 'schemas', 'services'];
const BANNED = [/\bMath\.random\s*\(/, /\bDate\.now\s*\(/, /\bnew Date\s*\(/, /\bperformance\.now\s*\(/];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) return sourceFiles(full);

    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('compile path purity', () => {
  it('never reads the clock or Math.random', () => {
    const offenders = COMPILE_PATH_DIRS.flatMap((dir) => sourceFiles(path.join(src, dir))).flatMap((file) => {
      const code = stripComments(fs.readFileSync(file, 'utf8'));

      return BANNED.filter((pattern) => pattern.test(code)).map((pattern) => `${path.relative(src, file)}: ${pattern}`);
    });

    expect(offenders).toEqual([]);
  });
});
