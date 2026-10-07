import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compile, container, loadConfig } from '@/index';
import type { ProjectConfig, TemplateDescriptor } from '@/core/types';
import type AbstractFFmpeg from '@/platform/ffmpeg/AbstractFFmpeg';
import { MAX_EMOJI_OVERLAYS } from '@/core/emoji-assets';
import { DryRunFFmpeg } from './fixtures/dry-run-ffmpeg';
import { testBuildDir } from './fixtures/build-dir';

// Emoji lowering end to end through the dry-run adapter: the commands a template with emoji compiles to.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const libDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/library');
const templatesDir = path.resolve(repoRoot, 'packages/leclap-creative-kit/src/templates');
const buildDir = testBuildDir('text-images');
const NBSP = ' ';

// Records the raw commands: the manifest normalizes every whitespace run, NBSP gaps included.
class RecordingFFmpeg extends DryRunFFmpeg {
  readonly commands: string[] = [];

  override execute = (command: string): Promise<{ rc: number }> => {
    this.commands.push(command);

    return new DryRunFFmpeg().execute(command);
  };
}

let realAdapter: AbstractFFmpeg;
let recorder: RecordingFFmpeg;

beforeAll(async () => {
  const first = fs.readdirSync(templatesDir).find((file) => file.endsWith('.json')) as string;

  await loadConfig(path.resolve(templatesDir, first));
  realAdapter = container.resolve<AbstractFFmpeg>('ffmpegAdapter');
  recorder = new RecordingFFmpeg();
  container.registerInstance('ffmpegAdapter', recorder);
});

afterAll(() => {
  container.registerInstance('ffmpegAdapter', realAdapter);
});

function template(section: Record<string, unknown>, global: Record<string, unknown> = {}): TemplateDescriptor {
  return {
    global: { musicEnabled: false, ...global },
    sections: [
      { name: 'card', type: 'color_background', options: { duration: 3, backgroundColor: '#101010' }, ...section },
    ],
  } as unknown as TemplateDescriptor;
}

// The section's own command (the first one; the second is the final remux).
async function sectionCommand(descriptor: TemplateDescriptor): Promise<string> {
  const config = {
    buildDir,
    assetsDir: libDir,
    currentLocale: 'en',
    audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
    videoConfig: { orientation: 'landscape', scale: '1280:720' },
    skipValidation: true,
  } as unknown as ProjectConfig;

  recorder.commands.length = 0;
  await compile(config, descriptor);

  return recorder.commands[0];
}

function caption(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { caption: { text: { en: text }, style: 'subtle', ...extra } };
}

describe('emoji lowering', () => {
  it('composites a caption emoji as an image overlay in the measured gap', async () => {
    const graph = await sectionCommand(template(caption('Hot 🔥 deal')));

    // The emoji leaves the text for a gap of no-break spaces…
    expect(graph).toContain(`drawtext=text='Hot ${NBSP.repeat(4)} deal'`);
    // …and comes back as a still input, scaled to 1.1× the 44px caption and overlaid in the gap, after
    // the text (so a caption box can't cover it) and before the colour tag.
    expect(graph).toMatch(/-loop 1 -i \S+\/emoji\/1f525\.png/);
    expect(graph).toContain('[2:v]scale=48:48,format=rgba[card_emoji_0_src]');
    expect(graph).toContain('[card_emoji_base][card_emoji_0_src]overlay=610:557[card_emoji_0]');
    expect(graph).toContain('[card_emoji_0]setparams=');
    expect(graph).toContain('-map [ctag]');
  });

  it('stages the bundled image into the build directory', async () => {
    await sectionCommand(template(caption('Ship 🚀')));

    expect(fs.existsSync(path.join(buildDir, 'emoji', '1f680.png'))).toBe(true);
  });

  it('places centred title-card lines from their measured widths', async () => {
    const titleCard = { headline: { en: 'Launch 🚀' }, subtitle: { en: 'Made in 🇫🇷' }, align: 'center' };
    const graph = await sectionCommand(template({ titleCard }));

    expect(graph).toContain('1f680.png');
    expect(graph).toContain('1f1eb-1f1f7.png');
    expect(graph.match(/overlay=/g)).toHaveLength(2);
  });

  it('shares the text reveal: a moving overlay expression and an alpha fade-in', async () => {
    const graph = await sectionCommand(template(caption('Go 👉', { reveal: 'rise' })));

    expect(graph).toContain('format=rgba,fade=t=in:st=0.3:d=0.6:alpha=1[card_emoji_0_src]');
    expect(graph).toMatch(/overlay=x='\d+':y='\(\(\(H-\([\d.]+\)\)-110\)\+\(1-\(if\(lt\(t,0\.3\)/);
  });

  it('shares the text enable window', async () => {
    const values = { text: { en: '✅ done' }, fontfile: 'Rubik.ttf', fontsize: 40, x: 100, y: 200 };
    const filters = [{ type: 'drawtext', values: { ...values, enable: "'between(t,1,2)'" } }];
    const graph = await sectionCommand(template({ filters }));

    expect(graph).toContain("overlay=99:200:enable='between(t,1,2)'");
  });

  it('lays kinetic units out with emoji as whole images', async () => {
    const graph = await sectionCommand(template({ kinetic: [{ text: { en: 'So good 🔥' }, preset: 'pop' }] }));

    expect(graph).toContain('1f525.png');
    expect(graph).not.toContain('🔥');
  });

  it('composites over an image-overlay graph, above its text', async () => {
    const inputs = [{ name: 'logo', type: 'image', url: 'pictures/logo.png', options: {} }];
    const graph = await sectionCommand(template({ inputs, ...caption('Logo 😎') }));

    expect(graph).toMatch(/\[card_text\]\[card_emoji_0_src\]overlay=/);
  });

  it('strips emoji without overlays in strip mode', async () => {
    const graph = await sectionCommand(template(caption('Hot 🔥 deal'), { emoji: 'strip' }));

    expect(graph).toContain("drawtext=text='Hot  deal'");
    expect(graph).not.toContain('emoji');
  });

  it("keeps today's drawtext in error mode", async () => {
    const graph = await sectionCommand(template(caption('Hot 🔥'), { emoji: 'error' }));

    expect(graph).toContain("drawtext=text='Hot 🔥'");
    expect(graph).not.toContain('emoji');
  });

  it('strips an emoji with no bundled image', async () => {
    const graph = await sectionCommand(template(caption('Troll 🧌')));

    expect(graph).toContain("drawtext=text='Troll '");
    expect(graph).not.toContain('overlay');
  });

  it(`caps a section at ${MAX_EMOJI_OVERLAYS} images`, async () => {
    const graph = await sectionCommand(template(caption('🔥'.repeat(MAX_EMOJI_OVERLAYS + 6))));

    expect(graph.match(/overlay=/g)).toHaveLength(MAX_EMOJI_OVERLAYS);
  });

  it('leaves text without emoji untouched (no image input, linear -vf chain)', async () => {
    const graph = await sectionCommand(template(caption('Plain text')));

    expect(graph).not.toContain('emoji');
    expect(graph).toContain(' -vf ');
  });
});
