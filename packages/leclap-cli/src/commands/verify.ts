import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import {
  MANIFEST_SCHEMA_VERSION,
  compile,
  digestRenderedFile,
  type ProjectConfig,
  type RenderManifest,
  type TemplateDescriptor,
} from 'ffmpeg-video-composer';
import { setEngineLogLevel } from '../log.js';
import { parseKeyValues, collectRepeated } from '../render-args.js';
import { checkOutput, compareRenders, firstGraphDifference, type VerifyCheck } from '../verify-checks.js';
import { fail, hint } from '../ui.js';
import { ok, bad } from '../theme.js';

// `leclap verify <video>.manifest.json`: is this file still the render the manifest describes? With
// --rerender, render the recorded template again and compare every digest (template, assets, graph,
// output). On the same platform profile and engine, a deterministic render must match byte for byte.

function loadManifest(file: string): RenderManifest {
  // Parsed from disk, so the schema version is whatever the file says, not the type's literal.
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Omit<RenderManifest, 'schemaVersion'> & {
    schemaVersion: unknown;
  };

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported manifest schemaVersion ${String(manifest.schemaVersion)}`);
  }

  return manifest as RenderManifest;
}

function defaultVideoFor(manifestFile: string): string {
  return manifestFile.replace(/\.manifest\.json$/, '');
}

interface RerenderInput {
  manifest: RenderManifest;
  buildDir: string;
  assetsDir: string;
  inputs: Record<string, string>;
}

// The recorded config (locale, fields, codec, scale…) with this machine's directories and clips.
function rerenderConfig(input: RerenderInput): ProjectConfig {
  const recorded = input.manifest.config as Partial<ProjectConfig> & { videoCodec?: string | null };

  return {
    buildDir: input.buildDir,
    assetsDir: input.assetsDir,
    currentLocale: recorded.currentLocale ?? undefined,
    fields: recorded.fields,
    qualityTier: recorded.qualityTier,
    videoConfig: recorded.videoConfig ?? undefined,
    audioConfig: recorded.audioConfig ?? undefined,
    ...(recorded.videoCodec && { codecConfig: { videoCodec: recorded.videoCodec } }),
    userVideoPaths: Object.keys(input.inputs).length > 0 ? input.inputs : undefined,
    deterministic: input.manifest.deterministic,
    skipValidation: true,
  };
}

async function rerender(input: RerenderInput): Promise<RenderManifest> {
  let fresh: RenderManifest | undefined;
  const failure: { error?: Error } = {};
  await fs.mkdir(input.buildDir, { recursive: true });
  const output = await compile(rerenderConfig(input), input.manifest.template.descriptor as TemplateDescriptor, {
    onManifest: (manifest) => (fresh = manifest),
    onError: (error) => (failure.error = error),
  });

  if (!output || !fresh) throw failure.error ?? new Error('re-render failed');

  return fresh;
}

function printChecks(checks: VerifyCheck[], diff: string | null): void {
  for (const check of checks) {
    const detail = check.ok
      ? pc.dim(check.expected)
      : `${pc.dim('expected')} ${check.expected} ${pc.dim('got')} ${check.actual}`;
    console.log(`  ${check.ok ? ok : bad} ${check.check.padEnd(9)}${detail}`);
  }

  if (diff) console.log(hint(`\n  first differing command:\n${diff}`));
}

function report(result: { json: boolean; passed: boolean; checks: VerifyCheck[]; diff: string | null }): void {
  if (result.json) {
    process.stdout.write(`${JSON.stringify({ ok: result.passed, checks: result.checks })}\n`);

    return;
  }

  printChecks(result.checks, result.passed ? null : result.diff);
}

export const verify = defineCommand({
  meta: { name: 'verify', description: 'Check a video against its render manifest' },
  args: {
    manifest: { type: 'positional', description: 'Path to a <video>.manifest.json', required: true },
    video: { type: 'string', description: 'Video to check (default: the manifest path minus .manifest.json)' },
    rerender: { type: 'boolean', description: 'Render the recorded template again and compare', default: false },
    input: { type: 'string', description: 'Clip for a project_video section: --input section=path (repeatable)' },
    assets: { type: 'string', description: 'Assets directory for --rerender (default ./assets)' },
    build: { type: 'string', description: 'Build directory for --rerender (default ./build/verify)' },
    json: { type: 'boolean', description: 'Emit a machine-readable JSON result', default: false },
  },
  async run({ args, rawArgs }) {
    setEngineLogLevel('silent');

    try {
      const manifest = loadManifest(args.manifest);
      const video = args.video ?? defaultVideoFor(args.manifest);
      const checks = [checkOutput(manifest, existsSync(video) ? digestRenderedFile(video) : null)];
      let diff: string | null = null;

      if (args.rerender) {
        const fresh = await rerender({
          manifest,
          buildDir: path.resolve(args.build ?? 'build/verify'),
          assetsDir: path.resolve(args.assets ?? 'assets'),
          inputs: parseKeyValues(collectRepeated(rawArgs, 'input'), 'input'),
        });
        checks.push(...compareRenders(manifest, fresh));
        diff = firstGraphDifference(manifest, fresh);
      }

      const passed = checks.every((check) => check.ok);

      report({ json: args.json, passed, checks, diff });

      process.exitCode = passed ? 0 : 1;
    } catch (error) {
      console.error(fail(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  },
});
