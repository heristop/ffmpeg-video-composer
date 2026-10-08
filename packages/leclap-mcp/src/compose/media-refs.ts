import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCatalogAssetPath, type TemplateDescriptor } from 'ffmpeg-video-composer';

import type { GuardResult } from './descriptorGuard.js';

// A media reference the engine stages from the media dir (its assetsDir) — a section background, an
// input, a LUT, a whole-video overlay — is looked for there first. When it is missing, the engine used to
// fetch any relative path from the remote asset catalog, so a local file the author forgot to put in the
// media dir failed with the network's error ("self-signed certificate", a 404) after a render started.
// This checks the references up front, the way the engine resolves them: http(s) URLs and catalog paths
// (`pictures/logo.png`, the samples' own assets) are left to the engine; every other path must exist
// under the media dir. Music is left out: the engine also finds a track by its name.

const VARIABLE = /^\{\{\s*([\w.-]+)\s*\}\}$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ASSETS_MARKER = '/assets/';

type Variables = Record<string, unknown>;

function isMediaKey(key: string): boolean {
  return key === 'url' || key.endsWith('Url');
}

// Every `url` / `*Url` string under `value`, skipping global.music.
function* mediaRefs(value: unknown, key = ''): Generator<string> {
  if (typeof value === 'string') {
    if (isMediaKey(key)) yield value;

    return;
  }

  if (value === null || typeof value !== 'object' || key === 'music') return;

  for (const [childKey, child] of Object.entries(value)) {
    yield* mediaRefs(child, Array.isArray(value) ? key : childKey);
  }
}

// A `{{ name }}` reference resolves through global.variables; anything still templated (a field filled at
// render time) can't be checked here and is left to the engine.
function resolveRef(ref: string, variables: Variables): string | undefined {
  const variable = VARIABLE.exec(ref.trim());
  const resolved = variable ? variables[variable[1]] : ref;

  if (typeof resolved !== 'string' || resolved.includes('{{')) return undefined;

  return resolved;
}

// Where the engine's Node adapter looks for a local reference (its localCandidate), or undefined when the
// reference is not local: a remote URL, a generated `panel:`/`sprite:` image, or a catalog path.
function localCandidate(ref: string, mediaDir: string): string | undefined {
  if (/^https?:\/\//i.test(ref) || isCatalogAssetPath(ref)) return undefined;

  if (ref.startsWith('file:')) return path.join(mediaDir, path.basename(fileURLToPath(ref)));

  if (SCHEME.test(ref)) return undefined;

  if (path.isAbsolute(ref) && ref.includes(ASSETS_MARKER)) {
    return path.join(mediaDir, ref.slice(ref.lastIndexOf(ASSETS_MARKER) + ASSETS_MARKER.length));
  }

  return path.isAbsolute(ref) ? ref : path.join(mediaDir, ref);
}

async function isWithin(candidate: string, mediaDir: string): Promise<boolean> {
  const [real, realMedia] = await Promise.all([fs.realpath(candidate).catch(() => ''), fs.realpath(mediaDir)]);

  return real !== '' && (real === realMedia || real.startsWith(realMedia + path.sep));
}

async function missingRef(ref: string, mediaDir: string): Promise<string | undefined> {
  const candidate = localCandidate(ref, mediaDir);

  if (candidate === undefined || (await isWithin(candidate, mediaDir))) return undefined;

  return (
    `Media "${ref}" is not in the media dir (${mediaDir}). A local path is never fetched remotely: copy the ` +
    'file under the media dir and reference it by its path there (relative, or absolute under it), or use an ' +
    'http(s) URL.'
  );
}

export async function assertMediaRefsLocal(descriptor: TemplateDescriptor, mediaDir: string): Promise<GuardResult> {
  const variables = (descriptor.global?.variables ?? {}) as Variables;
  const refs = [...mediaRefs(descriptor.sections), ...mediaRefs(descriptor.global)]
    .map((ref) => resolveRef(ref, variables))
    .filter((ref): ref is string => ref !== undefined);
  const problems = await Promise.all(refs.map((ref) => missingRef(ref, mediaDir)));
  const message = problems.find((problem) => problem !== undefined);

  return message === undefined ? { ok: true } : { ok: false, message };
}
