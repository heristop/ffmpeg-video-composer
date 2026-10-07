import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { bundledVideoFor, fieldsFor, videoFor } from './fixtures.ts';
import { previewVideoArgs } from './preview-export.ts';
import { loadDescriptor } from './load-descriptor.ts';
import { prepareSynthetic, prerenderedFor, previewMedia, withVariables } from './synthetic-media.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const catalog = JSON.parse(await fs.readFile(path.join(root, 'examples/showcase/catalog.json'), 'utf8'));
const publicDir = path.join(root, 'apps/leclap-web/public/videos/showcase');
const work = path.join(root, 'build/showcase');
const library = path.join(root, 'packages/leclap-creative-kit/src/library');
const example = path.join(root, 'examples/llm-remotion-title');
const requested = process.argv.indexOf('--id');
const selectedIds = requested < 0 ? null : new Set((process.argv[requested + 1] ?? '').split(','));
const samples = catalog.samples.filter((sample) => !selectedIds || selectedIds.has(sample.id));

if (samples.length === 0) throw new Error('No matching sample. Use --id with catalog ids, or omit it to render all.');
await fs.mkdir(publicDir, { recursive: true });
await fs.mkdir(work, { recursive: true });
process.env.LECLAP_LOG_LEVEL = 'silent';
const { compile, expandPartials, TemplateValidator } =
  await import('../../packages/ffmpeg-video-composer/dist/index.js');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr.length > 0 ? result.stderr : result.stdout}`);
  }

  return result.stdout;
}
function ffmpeg(args) {
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}
function probe(file) {
  return JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
}
// Poster frame per sample (seconds), when the default 1.4 s lands mid-motion.
const POSTER_AT = {
  'product-launch': 3.4,
  'kinetic-type': 2.4,
  'fx-pack': 0.4,
  'word-captions': 1,
  formats: 1.5,
  'kinetic-fills': 1.6,
  'split-layouts': 1.6,
  'rtl-type': 1.8,
  'emoji-type': 1.2,
  'beat-grid': 1.8,
  'theme-roles': 2,
  'footage-edit': 1,
  'sound-design': 3.3,
  'effects-tour': 2.2,
};
const fields = {
  form_1_name: 'KILN',
  form_1_tagline: 'Made for everyday rituals',
  form_1_price: 'EUR 24',
  form_1_app: 'LeClap',
  form_1_promise: 'Your story in motion',
  form_1_feature: 'Build your next scene',
  form_1_cta: 'Create your first video',
  form_1_topic: 'Move your caption',
  form_1_step: 'Drag the text into place',
  form_1_headline: 'Everyday rituals',
  form_1_subtitle: 'Made for slow mornings',
  form_1_scene1: 'Slow mornings',
  form_1_scene2: 'Find your rhythm',
  form_1_scene3: 'Make it count',
};

// Generic registered examples keep their synthetic fixtures; the app promo uses a bundled real capture.
const appCapture = path.join(work, 'demo-app.mp4');

if (samples.some((sample) => (sample.id === 'app-tutorial' ? true : sample.source.includes('llm-remotion-title')))) {
  run('node', ['examples/llm-remotion-title/generate-media.mjs', path.join(library, 'fonts/BebasNeue.ttf')]);
  ffmpeg([
    '-loop',
    '1',
    '-i',
    path.join(example, 'media/screenshot.png'),
    '-t',
    '12',
    '-vf',
    `drawtext=fontfile=${path.join(library, 'fonts/Oswald.ttf')}:text='Drag to arrange':fontsize=38:fontcolor=white:x='310+90*sin(t)':y=275`,
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-pix_fmt',
    'yuv420p',
    appCapture,
  ]);
}
let evidenceReady = false;
/** @type {{ client?: { close: () => Promise<void>, callTool: (request: object) => Promise<{ isError?: boolean, content?: unknown, structuredContent: { outputPath: string } }> } }} */
const connection = {};
async function registeredClient() {
  if (connection.client) return connection.client;
  const require = createRequire(path.join(root, 'packages/leclap-mcp/package.json'));
  const { Client } = await import(require.resolve('@modelcontextprotocol/client'));
  const { StdioClientTransport } = await import(require.resolve('@modelcontextprotocol/client/stdio'));
  const client = new Client({ name: 'leclap-showcase', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: 'node',
      args: [
        path.join(root, 'packages/leclap-mcp/dist/index.js'),
        '--allow-remotion',
        '--remotion-entry',
        path.join(example, 'remotion/index.ts'),
        '--effect-catalog',
        path.join(example, 'effect-catalog.json'),
        '--media-dir',
        example,
        '--output-dir',
        path.join(work, 'registered'),
      ],
      stderr: 'inherit',
    })
  );
  connection.client = client;

  return client;
}
async function evidence() {
  if (evidenceReady) return;
  const directory = path.join(work, 'evidence');
  await fs.mkdir(path.join(directory, 'raw'), { recursive: true });
  // Capture the actual runnable synthetic before/after shop so labels match the recorded behavior.
  run(
    'node',
    [path.join(root, 'examples/agentic-pr-video/demo-shop/record.mjs'), '--out', path.join(directory, 'raw')],
    path.join(root, 'apps/leclap-web')
  );
  run('python3', [
    'examples/agentic-pr-video/evidence-skill/build.py',
    '--content',
    'examples/agentic-pr-video/evidence-skill/content.example.json',
    '--work',
    directory,
    '--fonts',
    path.join(library, 'fonts'),
    '--logo',
    path.join(root, 'apps/leclap-web/public/pwa-512x512.png'),
  ]);
  evidenceReady = true;
}
const manifestPath = path.join(publicDir, 'manifest.json');
let previous = [];

try {
  previous = JSON.parse(await fs.readFile(manifestPath, 'utf8')).samples;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const byId = new Map(previous.map((record) => [record.id, record]));
async function saveManifest() {
  const temporary = `${manifestPath}.tmp`;
  await fs.writeFile(
    temporary,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        renderer: 'examples/showcase/render-previews.mjs',
        preview: '960x540, H264, 24fps, AAC audio when present; original orientation letterboxed',
        samples: catalog.samples.flatMap((sample) => (byId.has(sample.id) ? [byId.get(sample.id)] : [])),
      },
      null,
      2
    )}\n`
  );
  await fs.rename(temporary, manifestPath);
}
function validatedDescriptor(template, id) {
  const result = new TemplateValidator().validateTemplate(expandPartials(template));

  if (!result.success) throw new Error(`${id}: ${JSON.stringify(result.errors)}`);

  return result.data;
}
async function evidenceInputs(sample, template) {
  const clips = {};
  await evidence();
  const directory = path.join(work, 'evidence');

  if (sample.id === 'house-evidence') {
    const resolved = JSON.parse(await fs.readFile(path.join(directory, 'evidence.template.json'), 'utf8'));
    const assets = path.join(directory, 'assets');

    for (const section of validatedDescriptor(resolved, sample.id).sections.filter(
      (section) => section.type === 'project_video'
    )) {
      clips[section.name] = path.join(assets, 'videos', `${section.name}.mp4`);
    }

    return { template: resolved, assetRoot: assets, clips, sampleFields: fields };
  }

  for (const section of validatedDescriptor(template, sample.id).sections.filter(
    (section) => section.type === 'project_video'
  )) {
    clips[section.name] = path.join(directory, 'raw', `${section.name === 'before' ? 'before' : 'after'}.mp4`);
  }

  return { template, assetRoot: library, clips, sampleFields: fields };
}
async function nativeInputs(sample, template) {
  const clips = {};

  if (sample.category === 'evidence') return evidenceInputs(sample, template);
  const prerendered = prerenderedFor(sample.id);

  if (prerendered) {
    run('bash', [prerendered.script, '--chapters-only']);

    return { template, assetRoot: path.join(root, prerendered.assets), clips, sampleFields: fields };
  }
  const expanded = validatedDescriptor(template, sample.id);
  const sampleFields = fieldsFor(
    expanded,
    sample.id === 'product-launch'
      ? { ...fields, form_1_name: 'Moo Mug', form_1_tagline: 'Made for coffee breaks' }
      : fields
  );
  const bundled = bundledVideoFor(sample.id);
  const capture = bundled ? path.join(root, bundled) : { 'app-tutorial': appCapture }[sample.id];
  const synthetic = await prepareSynthetic(sample.id, { library, work, ffmpeg });
  let index = 0;

  for (const section of expanded.sections.filter((section) => section.type === 'project_video')) {
    clips[section.name] =
      synthetic.clips[section.name] ??
      capture ??
      path.join(library, 'videos', videoFor(expanded.global.orientation, index++));
  }

  return { template: withVariables(template, synthetic.variables), assetRoot: library, clips, sampleFields };
}
async function renderOutput(sample, template, registered) {
  if (registered) {
    const mcp = await registeredClient();
    const result = await mcp.callTool({ name: 'compose_video', arguments: { template, outputBaseName: sample.id } });

    if (result.isError) throw new Error(`${sample.id}: ${JSON.stringify(result.content)}`);

    return result.structuredContent.outputPath;
  }
  const input = await nativeInputs(sample, template);
  const output = await compile(
    {
      buildDir: path.join(work, 'full', sample.id),
      assetsDir: input.assetRoot,
      currentLocale: 'en',
      fields: input.sampleFields,
      userVideoPaths: input.clips,
      videoConfig: { scale: '1280:720', orientation: input.template.global.orientation ?? 'landscape', fps: 30 },
      audioConfig: { sampleRate: 44100, channelLayout: 'stereo' },
      hardwareConfig: { maxRenderConcurrency: 1 },
    },
    input.template
  );

  if (!output) throw new Error(`Render failed: ${sample.id}`);

  return output;
}
async function renderSample(sample) {
  const original = await loadDescriptor(root, sample);
  const expanded = validatedDescriptor(original, sample.id);
  const registered = expanded.sections.some((section) => section.type === 'effect');
  const output = await renderOutput(sample, original, registered);
  const video = path.join(publicDir, `${sample.id}.mp4`);
  ffmpeg(previewVideoArgs(output, video));
  const metadata = probe(video);
  const duration = Number(metadata.format.duration);
  const posterTime = Math.min(POSTER_AT[sample.id] ?? 1.4, duration / 3);
  const poster = path.join(publicDir, `${sample.id}.webp`);
  ffmpeg(['-ss', String(posterTime), '-i', video, '-frames:v', '1', '-vf', 'scale=720:405', '-quality', '85', poster]);
  // Optional local provenance tool; the portable manifest below always records the render source.
  if (process.env.LECLAP_IMAGE_METADATA_TOOL) {
    run(process.env.LECLAP_IMAGE_METADATA_TOOL, [
      'embed-prompt',
      poster,
      '--prompt',
      `Source: a rendered frame of ${sample.source}${sample.section ? `, section ${sample.section}` : ''}; generated by examples/showcase/render-previews.mjs with bundled demo media. Frame at ${posterTime}s. No generated image model used.`,
    ]);
  }
  await fs.writeFile(path.join(publicDir, `${sample.id}.json`), `${JSON.stringify(original, null, 2)}\n`);
  const record = {
    id: sample.id,
    source: sample.source,
    section: sample.section,
    duration,
    hasAudio: metadata.streams.some((stream) => stream.codec_type === 'audio'),
    orientation: original.global.orientation ?? 'landscape',
    backend: registered ? 'remotion' : 'native',
    sha256: createHash('sha256')
      .update(await fs.readFile(video))
      .digest('hex'),
    templateSha256: createHash('sha256').update(JSON.stringify(original)).digest('hex'),
    ...previewMedia(sample, expanded, bundledVideoFor(sample.id)),
    bytes: (await fs.stat(video)).size,
  };
  byId.set(sample.id, record);
  await saveManifest();
  console.log(`${sample.id}: ${duration.toFixed(2)}s, ${Math.round(record.bytes / 1024)} KB`);
}

try {
  // Serialize full renders to bound simultaneous FFmpeg/Chromium memory.
  await samples.reduce((pending, sample) => pending.then(() => renderSample(sample)), Promise.resolve());
} finally {
  if (connection.client) await connection.client.close();
}
