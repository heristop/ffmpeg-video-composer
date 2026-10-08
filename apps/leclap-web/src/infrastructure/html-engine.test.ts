import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTML_WASM_FILES, HTML_WASM_VERSION } from 'ffmpeg-video-composer/src/core/html/html-engine.ts';
import { loadSelfHostedHtmlWasm } from '@/infrastructure/html-engine';
import { stageHtmlEngine } from '../../scripts/stage-html-engine.ts';

const RESVG = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01]);
const HARFBUZZ = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x02]);
const SHAPER = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x03]);

let root: string;
let publicDir: string;

// Stand-ins for the installed @resvg/resvg-wasm and harfbuzzjs packages.
function writePackages(versions: { resvg?: string; harfbuzz?: string } = {}): (name: string) => string {
  const dirs = new Map<string, string>();

  for (const [key, bytes] of [
    ['resvg', RESVG],
    ['harfbuzz', HARFBUZZ],
    ['shaper', SHAPER],
  ] as const) {
    const spec = HTML_WASM_FILES[key];
    const dir = join(root, 'packages', spec.package);
    const version = key === 'resvg' ? versions.resvg : versions.harfbuzz;

    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: spec.package, version: version ?? spec.version }));
    writeFileSync(join(dir, spec.file), bytes);
    dirs.set(spec.package, dir);
  }

  return (name) => dirs.get(name) as string;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stage-html-engine-'));
  publicDir = join(root, 'public');
  mkdirSync(publicDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('stageHtmlEngine', () => {
  it('stages both wasm files under a versioned path, each well under the 25 MiB a Pages file may weigh', () => {
    const dir = stageHtmlEngine({ packageDir: writePackages(), publicDir });

    expect(dir).toBe(join(publicDir, 'html-engine', HTML_WASM_VERSION));
    expect(new Uint8Array(readFileSync(join(dir, 'resvg.wasm')))).toEqual(RESVG);
    expect(new Uint8Array(readFileSync(join(dir, 'hb-subset.wasm')))).toEqual(HARFBUZZ);
    expect(new Uint8Array(readFileSync(join(dir, 'hb.wasm')))).toEqual(SHAPER);
    expect(statSync(join(dir, 'resvg.wasm')).size).toBeLessThan(25 * 1024 * 1024);
  });

  it('refuses a package that is not the version the engine pins', () => {
    expect(() => stageHtmlEngine({ packageDir: writePackages({ resvg: '9.9.9' }), publicDir })).toThrow(
      /@resvg\/resvg-wasm 9\.9\.9 is installed/
    );
  });

  it('ships only the pinned version', () => {
    mkdirSync(join(publicDir, 'html-engine', 'resvg-0.0.1_harfbuzz-0.0.1'), { recursive: true });

    stageHtmlEngine({ packageDir: writePackages(), publicDir });

    expect(existsSync(join(publicDir, 'html-engine', 'resvg-0.0.1_harfbuzz-0.0.1'))).toBe(false);
  });
});

describe('loadSelfHostedHtmlWasm', () => {
  it('loads both modules from this origin', async () => {
    const dir = stageHtmlEngine({ packageDir: writePackages(), publicDir });
    const requested: string[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        const file = join(publicDir, url);

        return existsSync(file) ? new Response(new Uint8Array(readFileSync(file))) : new Response('', { status: 404 });
      })
    );

    const wasm = await loadSelfHostedHtmlWasm();

    expect(dir).toContain(HTML_WASM_VERSION);
    expect(requested.toSorted()).toEqual([
      `/html-engine/${HTML_WASM_VERSION}/hb-subset.wasm`,
      `/html-engine/${HTML_WASM_VERSION}/hb.wasm`,
      `/html-engine/${HTML_WASM_VERSION}/resvg.wasm`,
    ]);
    expect(new Uint8Array(wasm.resvg as ArrayBuffer)).toEqual(RESVG);
    expect(new Uint8Array(wasm.harfbuzz as ArrayBuffer)).toEqual(HARFBUZZ);
    expect(new Uint8Array(wasm.shaper as ArrayBuffer)).toEqual(SHAPER);
  });

  it('names the file that is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    );

    await expect(loadSelfHostedHtmlWasm()).rejects.toThrow(/html engine unavailable: \/html-engine\/.+ answered 404/);
  });
});
