import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSample, listSamples } from 'ffmpeg-video-composer/samples';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
let cwd: string;
beforeAll(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'leclap-samples-'));
});
afterAll(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});
async function run(args: string[]) {
  try {
    return {
      ...(await execute(process.execPath, [cli, 'samples', ...args], { cwd, maxBuffer: 2 * 1024 * 1024 })),
      code: 0,
    };
  } catch (error) {
    const result = error as { stdout: string; stderr: string; code: number };
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  }
}
describe('packaged samples command outside the repository', () => {
  it('lists all 47 samples as clean JSON and applies category/backend/query filters', async () => {
    const result = await run(['list', '--json']);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(listSamples());
    const filtered = await run([
      'list',
      '--category',
      'typography',
      '--backend',
      'remotion',
      '--query',
      'BLUR',
      '--json',
    ]);
    expect(JSON.parse(filtered.stdout).map((s: { id: string }) => s.id)).toEqual(['editorial-blur-rise']);
  });
  it('shows and exports every descriptor unchanged, including embedded partials', async () => {
    for (const summary of listSamples()) {
      const shown = await run(['show', summary.id, '--json']);
      expect(shown.code, shown.stderr).toBe(0);
      expect(JSON.parse(shown.stdout)).toEqual(getSample(summary.id));
      const exported = await run(['export', summary.id]);
      expect(exported.code, exported.stderr).toBe(0);
      expect(JSON.parse(exported.stdout)).toEqual(getSample(summary.id).template);
    }
  }, 60_000);
  it('makes human output useful for direction, fields, clips, assets and operator setup', async () => {
    const native = await run(['show', 'web-app-promo']);
    expect(native.stdout).toContain(getSample('web-app-promo').creativeDirection);
    expect(native.stdout).toContain('form_1_app');
    expect(native.stdout).toContain('video_1');
    expect(native.stdout).toContain('6.4');
    expect(native.stdout).toContain('screen');
    const effect = await run(['show', 'editorial-type']);
    expect(effect.stdout).toContain('studio.editorial-type@1.0.0');
    expect(effect.stdout).toMatch(/operator|catalog/);
    expect((await run(['show', 'pr-evidence'])).stdout).toContain('Anton.ttf');
  });
  it('writes a descriptor only to a new output path and preserves an existing file', async () => {
    const output = path.join(cwd, 'sample.json');
    const result = await run(['export', 'drink-and-code', '--output', output]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(await fs.readFile(output, 'utf8'))).toEqual(getSample('drink-and-code').template);
    await fs.writeFile(output, 'keep me');
    const duplicate = await run(['export', 'drink-and-code', '--output', output]);
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toMatch(/exist|overwrite/);
    expect(await fs.readFile(output, 'utf8')).toBe('keep me');
  });
  it.each([
    ['show', 'missing', '--json'],
    ['export', 'missing'],
    ['list', '--category', 'invalid', '--json'],
    ['list', '--backend', 'invalid', '--json'],
  ])('fails clearly without polluting stdout for %j', async (...args) => {
    const result = await run(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/Unknown sample|Invalid sample/);
  });
});
