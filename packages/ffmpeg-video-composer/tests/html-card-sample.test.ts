import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '@/index';
import { sha256Hex } from '@/core/determinism/sha256';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import { testBuildDir } from './fixtures/build-dir';

// The html-card sample's layers as Node draws them. The phone's device check
// (apps/leclap-expo/src/services/compile/html-layer-check.ts) compares its WebView PNGs with these same
// hashes: update both together when the sample or the renderer changes.
const GOLDENS = {
  'html-17ef0a6a002eaaa2.png': '81878beedd5f47aee0bc479bf077c7628e8d93514a18d008fba89cb796abfa9d',
  'html-cbc0d2cbe00a4460.png': '506c9036f95d8fe5267ebedde0f8be3e05eb5845238b0a3ac6403b775f033485',
  'html-f4f71ff926ebbe3d.png': 'fbce55fa1a1d932d52a5f62b13fb37d4d49ee16fbd2b49c6e702bedd291cf0db',
  'html-4bb7bdd4def3437a.png': 'b3bbd1f41de08076b56cac890e52f00b75d46286c151c5f38fd5099221d75a49',
  'html-302f27cbe1d5c936.png': '1a74c1668f4f450be870d094c588e93b2e5153b7e0e1026a9a18e5abc47ea604',
  'html-1a404a5cec992c54.png': '8f1aaa3d2364021184c0b8c794e96e035368850c12156be73c7d1aeb2f811387',
};

const here = path.dirname(fileURLToPath(import.meta.url));
const buildDir = testBuildDir('html-card-sample');

afterAll(() => {
  fs.rmSync(buildDir, { recursive: true, force: true });
});

describe('html-card sample', () => {
  it('stages its layers with the bytes the phone check expects', async () => {
    const descriptor = JSON.parse(
      fs.readFileSync(path.resolve(here, '../../../examples/motion-design/html-card.json'), 'utf8')
    ) as TemplateDescriptor;
    const config = {
      buildDir,
      assetsDir: path.resolve(here, '../../leclap-creative-kit/src/library'),
      currentLocale: 'en',
      audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
      videoConfig: { orientation: 'landscape', scale: '1280:720' },
      fields: {},
      userVideoPaths: {},
    } as unknown as ProjectConfig;

    expect(await compile(config, descriptor)).not.toBeNull();

    const panels = path.join(buildDir, 'panels');
    const staged = Object.fromEntries(
      fs
        .readdirSync(panels)
        .filter((file) => file.startsWith('html-'))
        .map((file) => [file, sha256Hex(new Uint8Array(fs.readFileSync(path.join(panels, file))))])
    );

    expect(staged).toEqual(GOLDENS);
  }, 120_000);
});
