import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { assertSafeSegmentName } from '@/core/arg-guard';
import { parseCommand } from '@/platform/ffmpeg/parse-command';
import { EffectSectionSchema } from '@/schemas/section.schemas';
import { stagedExtension } from '@/director/footage-source';
import { TemplateValidator } from '@/services/TemplateValidator';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// A section name becomes file names (`<buildDir>/<name>_output.mp4`, the concat list) written unquoted
// into the command string, and pad labels (`<name>_text`, `<name>_bg`) in the filter graph. A space, a
// quote or a filtergraph separator in it would add an argument or splice in a graph of its own.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');

const HOSTILE = [
  'intro ZZ',
  'intro"ZZ',
  "intro'ZZ",
  'intro[ZZ]',
  'intro;ZZ',
  'intro,ZZ',
  'intro:ZZ',
  'intro=ZZ',
  'intro\nZZ',
];

class RecordingFFmpeg extends DryRunFFmpeg {
  readonly commands: string[] = [];

  override execute = (command: string): Promise<{ rc: number }> => {
    this.commands.push(command);

    return new DryRunFFmpeg().execute(command);
  };
}

// A titled section, so the name also reaches the `<name>_text` pad.
function template(name: string): TemplateDescriptor {
  return {
    global: { musicEnabled: false },
    sections: [
      {
        name,
        type: 'color_background',
        options: { backgroundColor: '#000000', duration: 1 },
        titleCard: { headline: { en: 'Hello' } },
      },
    ],
  } as unknown as TemplateDescriptor;
}

let realAdapter: AbstractFFmpeg;

beforeAll(async () => {
  await loadConfig(path.resolve(templatesDir, 'app-tutorial.json'));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
}, 120000);

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

async function commandsOf(descriptor: TemplateDescriptor, skipValidation: boolean): Promise<string[]> {
  const recorder = new RecordingFFmpeg();
  container.registerInstance('ffmpegAdapter', recorder);

  await compile(
    {
      buildDir: testBuildDir('section-name-guard'),
      assetsDir: libDir,
      currentLocale: 'en',
      videoConfig: { scale: '1280:720' },
      skipValidation,
    } as ProjectConfig,
    descriptor,
    { onError: () => {} }
  );

  return recorder.commands;
}

describe('a section name never adds an argument or a graph', () => {
  for (const name of HOSTILE) {
    for (const skipValidation of [false, true]) {
      it(`refuses ${JSON.stringify(name)} (skipValidation: ${skipValidation})`, async () => {
        const commands = await commandsOf(template(name), skipValidation);
        const argv = commands.flatMap((command) => parseCommand(command));

        expect(commands.filter((command) => command.includes('ZZ'))).toEqual([]);
        expect(argv.filter((arg) => arg.includes('ZZ'))).toEqual([]);
      }, 120000);
    }

    it(`reports ${JSON.stringify(name)} at validation`, () => {
      expect(new TemplateValidator().validateTemplate(template(name)).success).toBe(false);
    });

    it(`refuses ${JSON.stringify(name)} at the render guard`, () => {
      expect(() => assertSafeSegmentName(name)).toThrow(/section name/);
    });
  }

  it.each(['intro', 'video_1', 'teal-orange-0.25', 'q1_card'])('keeps %s', (name) => {
    expect(assertSafeSegmentName(name)).toBe(name);
  });

  it('validates the same template with a plain name', () => {
    expect(new TemplateValidator().validateTemplate(template('intro')).errors ?? []).toEqual([]);
  });

  it('still refuses a traversal', () => {
    expect(() => assertSafeSegmentName('a..b')).toThrow(/section name/);
  });

  it.each(['.', '-', '_.', '-.-'])('refuses %j, which names no file', (name) => {
    expect(() => assertSafeSegmentName(name)).toThrow(/section name/);
    expect(new TemplateValidator().validateTemplate(template(name)).success).toBe(false);
  });

  it('applies the same grammar to an effect section', () => {
    const effect = {
      type: 'effect',
      effect: { id: 'x', version: '1.0.0', props: {}, assets: {} },
      options: { duration: 1 },
    };

    expect(EffectSectionSchema.safeParse({ ...effect, name: 'a b' }).success).toBe(false);
    expect(EffectSectionSchema.safeParse({ ...effect, name: 'fx_1' }).success).toBe(true);
  });

  it('stages a videoUrl under a letters-and-digits extension only', () => {
    expect(stagedExtension('https://host/a./tmp/x')).toBe('mp4');
    expect(stagedExtension('https://host/clip.mov')).toBe('mov');
    expect(stagedExtension('https://host/clip')).toBe('mp4');
  });
});
