import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../', import.meta.url));

describe('isolated installed samples entry', () => {
  it('imports ESM and CJS from an unrelated cwd with only published package files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'leclap-samples-'));
    try {
      const installed = path.join(directory, 'node_modules/ffmpeg-video-composer');
      await mkdir(installed, { recursive: true });
      await cp(path.join(pkg, 'dist'), path.join(installed, 'dist'), { recursive: true });
      await cp(path.join(pkg, 'package.json'), path.join(installed, 'package.json'));
      for (const format of ['module', 'commonjs']) {
        const script =
          format === 'module'
            ? "import { listSamples, getSample } from 'ffmpeg-video-composer/samples'; console.log(JSON.stringify([listSamples().length,getSample('product-reveal').requirements.effects[0].id,[...new Set(getSample('pr-evidence').requirements.assets.filter(a=>a.source==='preset').map(a=>a.reference))].sort()]));"
            : "const { listSamples, getSample } = require('ffmpeg-video-composer/samples'); console.log(JSON.stringify([listSamples().length,getSample('product-reveal').requirements.effects[0].id,[...new Set(getSample('pr-evidence').requirements.assets.filter(a=>a.source==='preset').map(a=>a.reference))].sort()]));";
        const result = spawnSync(process.execPath, ['--input-type', format, '-e', script], {
          cwd: directory,
          encoding: 'utf8',
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual([32, 'studio.product-reveal', ['Anton.ttf', 'Oswald.ttf']]);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('ships declarations and runtime data without Node or renderer dependencies', async () => {
    for (const name of ['samples.js', 'samples.cjs']) {
      const content = await readFile(path.join(pkg, 'dist', name), 'utf8');
      expect(/^\s*import\b/m.test(content)).toBe(false);
      expect(/^\s*(?:const|var|let)\s+.+\brequire\(/m.test(content)).toBe(false);
      expect(content).not.toMatch(/TemplateDirector|FFmpegNodeAdapter|tsyringe|registerEffect/);
    }
    expect(await readFile(path.join(pkg, 'dist/samples.d.ts'), 'utf8')).toContain('SampleDetail');
    expect(await readFile(path.join(pkg, 'dist/samples.d.cts'), 'utf8')).toContain('SampleDetail');
    for (const name of ['index.js', 'browser.js', 'reactnative.js']) {
      const content = await readFile(path.join(pkg, 'dist', name), 'utf8');
      expect(content).not.toContain('showcase?sample=');
      expect(content).not.toContain('editorial-word-stagger.json');
    }
  });
});
