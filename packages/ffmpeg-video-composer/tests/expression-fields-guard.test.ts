import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { assertSafeExpression } from '@/core/arg-guard';
import { TemplateValidator } from '@/services/TemplateValidator';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// Expression-typed fields (an overlay position or scale, a crop rectangle, a layer box) are spliced into
// the filtergraph by the engine itself, outside any authored filter. Each payload below chains a
// file-writing filter through one of them; none may reach an FFmpeg command, validated or not.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');

const CHAIN = ',metadata=print:a:b:same_str:1:pwned.txt';
const GRAPH = '[x];[0:v]metadata=print:a:b:same_str:1:pwned.txt[y]';

class RecordingFFmpeg extends DryRunFFmpeg {
  readonly commands: string[] = [];

  override execute = (command: string): Promise<{ rc: number }> => {
    this.commands.push(command);

    return new DryRunFFmpeg().execute(command);
  };
}

function section(extra: Record<string, unknown>, options: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'intro',
    type: 'color_background',
    options: { backgroundColor: '#000000', duration: 1, ...options },
    ...extra,
  };
}

function template(sections: unknown[], global: Record<string, unknown> = {}): TemplateDescriptor {
  return { global: { musicEnabled: false, ...global }, sections } as unknown as TemplateDescriptor;
}

function overlayInput(options: Record<string, unknown>): Record<string, unknown> {
  return section({ inputs: [{ name: 'logo', type: 'image', url: 'pictures/empty-1280.png', options }] });
}

function globalAnimation(options: Record<string, unknown>): TemplateDescriptor {
  return template([section({})], { animations: [{ url: 'animations/confetti.apng', ...options }] });
}

const CASES: Record<string, TemplateDescriptor> = {
  'inputs[].options.scale': template([overlayInput({ scale: `100:100${CHAIN}` })]),
  'inputs[].options.position': template([overlayInput({ position: `0:0${CHAIN}` })]),
  'inputs[].options.position (graph)': template([overlayInput({ position: `0:0${GRAPH}` })]),
  'global.animations[].position': globalAnimation({ position: `0:0${CHAIN}` }),
  'global.animations[].scale': globalAnimation({ scale: `100:100${CHAIN}` }),
  'motion crop w': template([section({ motion: [{ type: 'crop', w: `iw/2${CHAIN}`, h: 'ih/2' }] })]),
  'motion crop x': template([section({ motion: [{ type: 'crop', w: 'iw/2', h: 'ih/2', x: `0${CHAIN}` }] })]),
  'options.layers[].x': template([section({}, { layers: [{ color: '#ff0000', x: `0${CHAIN}`, w: 'iw*0.5' }] })]),
  'grade.curvesPreset': template([section({ grade: { curvesPreset: `vintage${CHAIN}` } })]),
  'filters[].values.enable': template([
    section({ filters: [{ type: 'drawbox', values: { x: 0, y: 0, w: 10, h: 10, enable: `1${CHAIN}` } }] }),
  ]),
};

let realAdapter: AbstractFFmpeg;

beforeAll(async () => {
  await loadConfig(path.resolve(templatesDir, 'app-tutorial.json'));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
}, 120000);

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

async function commandsOf(descriptor: TemplateDescriptor, config: Partial<ProjectConfig>): Promise<string[]> {
  const recorder = new RecordingFFmpeg();
  container.registerInstance('ffmpegAdapter', recorder);

  await compile(
    {
      buildDir: testBuildDir('expression-fields-guard'),
      assetsDir: libDir,
      currentLocale: 'en',
      videoConfig: { scale: '1280:720' },
      ...config,
    } as ProjectConfig,
    structuredClone(descriptor),
    { onError: () => {} }
  );

  return recorder.commands;
}

describe('expression fields never smuggle filtergraph syntax into an FFmpeg command', () => {
  for (const [name, descriptor] of Object.entries(CASES)) {
    for (const skipValidation of [false, true]) {
      it(`refuses ${name} (skipValidation: ${skipValidation})`, async () => {
        const commands = await commandsOf(descriptor, { skipValidation });

        expect(commands.filter((command) => command.includes('pwned'))).toEqual([]);
      }, 120000);
    }

    it(`reports ${name} at validation`, () => {
      expect(new TemplateValidator().validateTemplate(descriptor).success).toBe(false);
    });
  }

  it('still renders plain expressions', async () => {
    const descriptor = template([
      section({
        inputs: [
          {
            name: 'logo',
            type: 'image',
            url: 'pictures/empty-1280.png',
            options: { position: '(W-w)/2:H*0.1', scale: '320:-1' },
          },
        ],
        motion: [{ type: 'crop', w: 'iw*0.9', h: 'ih*0.9' }],
      }),
    ]);
    const commands = await commandsOf(descriptor, { skipValidation: false });

    expect(commands.some((command) => command.includes('overlay=(W-w)/2:H*0.1'))).toBe(true);
    expect(commands.some((command) => command.includes('scale=320:-1'))).toBe(true);
  }, 120000);
});

describe('textExpr is engine-internal', () => {
  const hostile = template([
    section({
      filters: [{ type: 'drawtext', values: { textExpr: "x':textfile=/etc/passwd:x='", fontsize: 20 } }],
    }),
  ]);

  it.each([false, true])(
    'refuses an authored textExpr (allowRawFilters: %s)',
    async (allowRawFilters) => {
      const commands = await commandsOf(hostile, { skipValidation: true, allowRawFilters });

      expect(commands.filter((command) => command.includes('passwd'))).toEqual([]);
    },
    120000
  );

  it.each([false, true])('reports an authored textExpr at validation (allowRawFilters: %s)', (allowRawFilters) => {
    const result = new TemplateValidator().validateTemplate(hostile, { allowRawFilters });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.errors)).toContain('textExpr');
  });
});

describe('assertSafeExpression', () => {
  it.each([
    ['0:0,null', 2],
    ['0:0[x]', 2],
    ["0:0'", 2],
    ['0 :0', 2],
    ['0:0;x', 2],
    ['a=b:0', 2],
    [String.raw`0\:0`, 2],
    ['1:2:3', 2],
    ['iw/2:0', 1],
  ])('refuses %s (%i part(s))', (value, parts) => {
    expect(() => assertSafeExpression(value, 'field', parts)).toThrow(/Unsafe field/);
  });

  it.each([
    ['(W-w)/2:H*0.1', 2],
    ['110:-1', 2],
    ['iw*0.46', 1],
    ['(iw-ow)/2', 1],
    [42, 1],
  ])('keeps %s', (value, parts) => {
    expect(assertSafeExpression(value, 'field', parts)).toBe(String(value));
  });
});
