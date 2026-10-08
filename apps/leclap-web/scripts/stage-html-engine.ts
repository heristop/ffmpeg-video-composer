// Stages the HTML layer rasteriser's WebAssembly (resvg, HarfBuzz's subsetter and the HarfBuzz build Satori
// shapes text with) into public/html-engine/<version>/ before `vite` runs (dev and build), so the builder's
// live preview and the browser render fetch it from this origin rather than a CDN: see
// src/infrastructure/html-engine.ts, which loads it. Satori's Yoga build is inlined in its JS.
//
// The versions are the engine's (HTML_WASM_FILES), and the installed packages have to match them. The files
// are small (~2.4 MB, ~0.6 MB and ~0.4 MB), far under the 25 MiB Cloudflare Pages takes per file, so they
// ship as is.
//
// Runs as plain `node scripts/stage-html-engine.ts`, hence the `.ts` extension on the engine import.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HTML_WASM_FILES, HTML_WASM_VERSION } from 'ffmpeg-video-composer/src/core/html/html-engine.ts';

export interface StageHtmlEngineOptions {
  /** The directory of an installed package, by name. */
  packageDir: (name: string) => string;
  /** The app's public/ directory. */
  publicDir: string;
}

/** The served name of each file (the resvg package calls its own `index_bg.wasm`). */
export const HTML_ENGINE_FILES = { resvg: 'resvg.wasm', harfbuzz: 'hb-subset.wasm', shaper: 'hb.wasm' } as const;

function installedVersion(dir: string): string {
  return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version;
}

/** Stage the files under `<publicDir>/html-engine/<version>/`; returns that directory. */
export function stageHtmlEngine({ packageDir, publicDir }: StageHtmlEngineOptions): string {
  const root = join(publicDir, 'html-engine');
  const dir = join(root, HTML_WASM_VERSION);

  mkdirSync(dir, { recursive: true });

  // Only the pinned version ships: an older one left here would ride along into every deploy.
  for (const entry of readdirSync(root)) {
    if (entry !== HTML_WASM_VERSION) rmSync(join(root, entry), { recursive: true, force: true });
  }

  for (const key of ['resvg', 'harfbuzz', 'shaper'] as const) {
    const spec = HTML_WASM_FILES[key];
    const source = packageDir(spec.package);
    const version = installedVersion(source);

    if (version !== spec.version) {
      throw new Error(
        `${spec.package} ${version} is installed but the engine pins ${spec.version} (HTML_WASM_FILES): bump both together.`
      );
    }

    const target = join(dir, HTML_ENGINE_FILES[key]);

    // Through a temp file, so an interrupted run can't leave a truncated module that passes for a staged one.
    if (!existsSync(target)) {
      copyFileSync(join(source, spec.file), `${target}.tmp`);
      renameSync(`${target}.tmp`, target);
    }
  }

  return dir;
}

if (import.meta.main) {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  // The packages are the engine's dependencies: resolved from the engine, not from this app.
  const engine = createRequire(fileURLToPath(import.meta.resolve('ffmpeg-video-composer/src/browser.ts')));
  // Through the wasm file itself (each sits at its package root): resvg's exports hide its package.json.
  const files = new Map(Object.values(HTML_WASM_FILES).map((spec) => [spec.package as string, spec.file as string]));
  const packageDir = (name: string): string => dirname(engine.resolve(`${name}/${files.get(name)}`));
  const dir = stageHtmlEngine({ packageDir, publicDir: join(appDir, 'public') });

  console.log(`✓ html engine ${HTML_WASM_VERSION} → ${relative(process.cwd(), dir)}`);
}
