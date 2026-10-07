import type { RenderManifest } from 'ffmpeg-video-composer';

// Pure comparison behind `leclap verify`: which digests of a manifest a file or a fresh render matches.

export interface VerifyCheck {
  check: 'output' | 'template' | 'graph' | 'assets';
  ok: boolean;
  expected: string;
  actual: string;
}

function short(digest: string | undefined): string {
  return digest ? digest.slice(0, 12) : 'none';
}

function assetsDigest(manifest: RenderManifest): string {
  return manifest.assets.map((asset) => `${asset.path}=${asset.sha256}`).join('\n');
}

/** Does the file on disk still hash to the manifest's output digest? */
export function checkOutput(manifest: RenderManifest, actual: { sha256: string } | null): VerifyCheck {
  const expected = manifest.output?.sha256;

  return {
    check: 'output',
    ok: Boolean(expected) && expected === actual?.sha256,
    expected: short(expected),
    actual: short(actual?.sha256),
  };
}

/** A fresh render of the manifest's template against the recorded one, digest by digest. */
export function compareRenders(expected: RenderManifest, actual: RenderManifest): VerifyCheck[] {
  const pairs: Array<[VerifyCheck['check'], string | undefined, string | undefined]> = [
    ['template', expected.template.sha256, actual.template.sha256],
    ['assets', assetsDigest(expected), assetsDigest(actual)],
    ['graph', expected.graph.sha256, actual.graph.sha256],
    ['output', expected.output?.sha256, actual.output?.sha256],
  ];

  return pairs.map(([check, want, got]) => ({
    check,
    ok: want !== undefined && want === got,
    expected: check === 'assets' ? `${expected.assets.length} files` : short(want),
    actual: check === 'assets' ? `${actual.assets.length} files` : short(got),
  }));
}

/** The first graph command that differs, to point at what changed when the graph digest does. */
export function firstGraphDifference(expected: RenderManifest, actual: RenderManifest): string | null {
  const count = Math.max(expected.graph.commands.length, actual.graph.commands.length);

  for (let index = 0; index < count; index++) {
    const want = expected.graph.commands.at(index);
    const got = actual.graph.commands.at(index);

    if (want !== got) return `- ${want ?? '(none)'}\n+ ${got ?? '(none)'}`;
  }

  return null;
}
