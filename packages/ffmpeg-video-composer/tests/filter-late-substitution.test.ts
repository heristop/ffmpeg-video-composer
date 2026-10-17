import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { resolveFields } from '@/core/fields';
import { authoredFilterIssues } from '@/editor/utils/filter-allow-list';
import { assertSafeFilterOptions, assertSafeFilterValue, assertSafePadLabel } from '@/editor/utils/filter-option-guard';
import { InputSchema } from '@/schemas/section-media.schemas';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// The raw filter allow-list must hold on the descriptor the build LOWERS, not only on the one it was
// handed: `$format` values, inline partial variables, declared fields and theme tokens are all
// substituted after the authored descriptor is read, and an input name becomes a pad label. Each
// payload below writes a file through `metadata=print`; none may reach an FFmpeg command, validated or
// not. Commands are recorded through the dry-run adapter (no FFmpeg runs).

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');

const PAYLOAD = 'print:a:b:same_str:1:pwned.txt';

class RecordingFFmpeg extends DryRunFFmpeg {
  readonly commands: string[] = [];

  override execute = (command: string): Promise<{ rc: number }> => {
    this.commands.push(command);

    return new DryRunFFmpeg().execute(command);
  };
}

function section(extra: Record<string, unknown>): Record<string, unknown> {
  return { name: 'intro', type: 'color_background', options: { backgroundColor: '#000000', duration: 1 }, ...extra };
}

function template(sections: unknown[], global: Record<string, unknown> = {}): TemplateDescriptor {
  return { global: { musicEnabled: false, ...global }, sections } as unknown as TemplateDescriptor;
}

const CASES: Record<string, { descriptor: TemplateDescriptor; config?: Partial<ProjectConfig> }> = {
  'a $format filter type': {
    descriptor: template([section({ filters: [{ type: { $format: { default: 'metadata' } }, value: PAYLOAD }] })]),
  },
  'a $format filter value': {
    descriptor: template([
      section({ filters: [{ type: 'vignette', value: { $format: { default: `PI/5,metadata=${PAYLOAD}` } } }] }),
    ]),
  },
  'an inline partial variable in a filter value': {
    descriptor: template([
      {
        type: 'partial',
        ref: 'p',
        variables: { v: `PI/5,metadata=${PAYLOAD}` },
        sections: [section({ filters: [{ type: 'vignette', value: '{{v}}' }] })],
      },
    ]),
  },
  'an input name that becomes a pad label': {
    descriptor: template([
      section({
        inputs: [{ name: `x];[0:v]metadata=${PAYLOAD}[y`, type: 'image', url: 'pictures/empty-1280.png', options: {} }],
      }),
    ]),
  },
  'a declared field filling a filter value': {
    descriptor: template([section({ filters: [{ type: 'vignette', value: '{{ LOOK }}' }] })], {
      fields: { LOOK: { type: 'text', default: 'PI/5' } },
    }),
    config: { fields: { LOOK: `PI/5,metadata=${PAYLOAD}` } },
  },
  'a declared field filling a filter type': {
    descriptor: template([section({ filters: [{ type: '{{ KIND }}', value: PAYLOAD }] })], {
      fields: { KIND: { type: 'text', default: 'vignette' } },
    }),
    config: { fields: { KIND: 'metadata' } },
  },
  'a theme token holding filter text': {
    descriptor: template([section({ filters: [{ type: 'vignette', value: '$color.accent' }] })], {
      theme: { extends: 'brand', colors: { accent: `PI/5,metadata=${PAYLOAD}` } },
    }),
  },
};

// Under the operator opt-in, a protocol behind an escaped `:` must still not reach FFmpeg.
const OPT_IN_CASES: Record<string, TemplateDescriptor> = {
  'an escaped file: protocol': template([
    section({ filters: [{ type: 'metadata', value: String.raw`print:a:b:same_str:1:'file\:/tmp/pwned.txt'` }] }),
  ]),
  'an escaped http: protocol': template([
    section({ filters: [{ type: 'metadata', value: String.raw`print:a:b:same_str:1:'http\://127.0.0.1/pwned'` }] }),
  ]),
};

let realAdapter: AbstractFFmpeg;
let recorder: RecordingFFmpeg;

beforeAll(async () => {
  await loadConfig(path.resolve(templatesDir, 'app-tutorial.json'));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
}, 120000);

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

async function commandsOf(descriptor: TemplateDescriptor, config: Partial<ProjectConfig>): Promise<string[]> {
  recorder = new RecordingFFmpeg();
  container.registerInstance('ffmpegAdapter', recorder);

  await compile(
    {
      buildDir: testBuildDir('filter-late-substitution'),
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

describe('late substitutions never smuggle a raw filter into an FFmpeg command', () => {
  for (const [name, { descriptor, config }] of Object.entries(CASES)) {
    for (const skipValidation of [false, true]) {
      it(`refuses ${name} (skipValidation: ${skipValidation})`, async () => {
        const commands = await commandsOf(descriptor, { ...config, skipValidation });

        expect(commands.filter((command) => command.includes('pwned'))).toEqual([]);
      }, 120000);
    }
  }

  for (const [name, descriptor] of Object.entries(OPT_IN_CASES)) {
    it(`refuses ${name} under allowRawFilters`, async () => {
      const commands = await commandsOf(descriptor, { allowRawFilters: true, skipValidation: true });

      expect(commands.filter((command) => command.includes('pwned'))).toEqual([]);
    }, 120000);
  }

  it('still renders an allow-listed filter resolved from a $format value', async () => {
    const descriptor = template([
      section({ filters: [{ type: 'vignette', value: { $format: { default: 'PI/5' } } }] }),
    ]);
    const commands = await commandsOf(descriptor, { skipValidation: true });

    expect(commands.some((command) => command.includes('vignette=PI/5'))).toBe(true);
  }, 120000);
});

describe('validation refuses what a later pass would substitute into filter text', () => {
  it.each([
    ['a $format type', { type: { $format: { default: 'metadata' } }, value: PAYLOAD }, 'type'],
    ['a $format value', { type: 'vignette', value: { $format: { default: 'PI/5' } } }, 'value'],
    ['a placeholder value', { type: 'vignette', value: '{{v}}' }, 'placeholder'],
    ['a $format values entry', { type: 'drawbox', values: { x: { $format: { default: '0' } } } }, 'values.x'],
    ['a scalar drawtext fontfile path', { type: 'drawtext', value: "fontfile='/etc/x.ttf':text=hi" }, 'fontfile'],
  ])('reports %s', (_name, filter, words) => {
    const issues = authoredFilterIssues({ sections: [section({ filters: [filter] })] });

    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('filter_not_allowed');
    expect(issues[0].message).toContain(words);
  });

  it('keeps plain filters and text placeholders', () => {
    const filters = [
      { type: 'vignette', value: 'PI/5' },
      { type: 'drawtext', values: { text: { en: 'Hi {{ NAME }}' }, fontfile: 'Rubik.ttf' } },
    ];

    expect(authoredFilterIssues({ sections: [section({ filters })] })).toEqual([]);
  });

  it('leaves a field with filtergraph syntax out of a filter value or type', () => {
    const descriptor = {
      global: { fields: { LOOK: { type: 'text' }, KIND: { type: 'text' } } },
      sections: [section({ filters: [{ type: '{{ KIND }}', value: '{{ LOOK }}' }] })],
    };
    const resolved = resolveFields(descriptor, { LOOK: `PI/5,metadata=${PAYLOAD}`, KIND: 'vignette=1:metadata' });

    expect(JSON.stringify(resolved.descriptor)).not.toContain('pwned');
    expect(resolved.issues.map((issue) => issue.field).sort()).toEqual(['KIND', 'LOOK']);
  });
});

describe('input names and pad labels', () => {
  it('refuses an input name that is not a plain label', () => {
    expect(InputSchema.safeParse({ name: 'x];[0:v]null[y', type: 'image', url: 'a.png' }).success).toBe(false);
    expect(InputSchema.safeParse({ name: 'quote_mark', type: 'image', url: 'a.png' }).success).toBe(true);
  });

  it.each(['x];[0:v]null[y', 'a,b', 'a;b', "a'b", 'a b'])('refuses the pad label %s', (label) => {
    expect(() => assertSafePadLabel(label)).toThrow(/pad label/);
  });

  it.each(['0:v', '@watermark', 'gradient_layer_0', 'quote-mark_src'])('keeps the pad label %s', (label) => {
    expect(assertSafePadLabel(label)).toBe(label);
  });
});

describe('the deny-list refuses an escaped protocol in both modes', () => {
  it.each([
    String.raw`print:a:b:same_str:1:'file\:/tmp/pwned'`,
    String.raw`print:a:b:same_str:1:'http\://127.0.0.1/x'`,
    String.raw`print:a:b:same_str:1:'data\:text/plain,x'`,
    String.raw`print:a:b:same_str:1:'concat\:a|b'`,
  ])('refuses metadata=%s', (value) => {
    expect(() => assertSafeFilterOptions('metadata', value)).toThrow(/protocol/);
  });

  it('refuses a protocol in a structured value', () => {
    expect(() => assertSafeFilterValue('x', String.raw`'subfile\:/etc/passwd'`)).toThrow(/protocol/);
  });

  it('refuses a scalar drawtext fontfile path', () => {
    expect(() => assertSafeFilterOptions('drawtext', "fontfile='/etc/x.ttf':text=hi")).toThrow(/fontfile/);
  });

  it.each([
    ['drawtext', String.raw`text='Note\: 10\:30':x=10`],
    ['fade', 'in:0:30'],
    ['fps', '30:start_time=0'],
    ['scale', '1280:720:force_original_aspect_ratio=increase'],
  ])('keeps %s=%s', (type, value) => {
    expect(assertSafeFilterOptions(type, value)).toBe(value);
  });

  it('keeps an escaped timecode in a structured value', () => {
    expect(assertSafeFilterValue('x', String.raw`'00\:00\:01'`)).toBe(String.raw`'00\:00\:01'`);
  });
});
