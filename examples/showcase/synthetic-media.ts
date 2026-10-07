// Synthetic media for showcase samples that edit footage or sound. Bundled clips and music are Git LFS
// objects, so these samples render from short clips generated on the fly instead: the bundled background
// photographs set in motion with FFmpeg (drift, push-in, a running clock), plus lavfi audio. Their
// previews illustrate the editing controls, not real footage. Each fixture is built once per run under
// build/showcase/fixtures/.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type CommandFixture = { file: string; args: string[] };
type TextFixture = { file: string; text: string };
export type SyntheticFixture = CommandFixture | TextFixture;
export type SyntheticInputs = { clips?: Record<string, string>; variables?: Record<string, string> };

const SECONDS = '8';
const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '30'];
const AAC = ['-c:a', 'aac', '-b:a', '96k'];
// A soft two-note pad so recorded scenes keep their own sound under the edit.
const PAD = `aevalsrc=0.1*sin(2*PI*220*t)+0.07*sin(2*PI*330*t):s=44100:d=${SECONDS}`;
// A voice-like line: a gliding, syllable-gated buzz over a low room rumble, for the voice preset to clean.
const VOICE =
  String.raw`aevalsrc=0.32*sin(2*PI*(150+40*sin(2*PI*1.3*t))*t)*(0.55+0.45*sin(2*PI*3.2*t))*gt(sin(2*PI*0.45*t)+0.6\,0)` +
  `+0.06*sin(2*PI*48*t):s=44100:d=${SECONDS}`;

/** A bundled photograph looped into an 8-second clip through `filter`, with a pad (or `audio`) track. */
function photoClip(library: string, file: string, photo: string, filter: string, audio = PAD): CommandFixture {
  const still = ['-loop', '1', '-framerate', '30', '-i', `${library}/backgrounds/${photo}`];

  return {
    file,
    args: [...still, '-f', 'lavfi', '-i', audio, '-vf', filter, ...H264, ...AAC, '-t', SECONDS],
  };
}

// A running clock in seconds, so speed ramps and freeze frames read on the clip itself.
function clock(library: string): string {
  const font = `${library}/fonts/Oswald.ttf`;

  return (
    `drawtext=fontfile=${font}:text='%{eif\\:t\\:d}.%{eif\\:mod(t*100\\,100)\\:d\\:2}':fontsize=64:` +
    'fontcolor=white:shadowcolor=black@0.5:shadowx=2:shadowy=3:x=w-tw-36:y=28'
  );
}

// A gentle warm print look as a 9³ .cube: lifted blacks, warm highlights, cooler shadows.
function warmCube(): string {
  const size = 9;
  const rows: string[] = ['TITLE "Showcase warm print"', `LUT_3D_SIZE ${size}`];

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [red, green, blue] = [r, g, b].map((value) => 0.04 + (value / (size - 1)) * 0.94);
        const out = [red ** 0.92 * 1.02, green ** 0.98, blue ** 1.08 * 0.94];
        rows.push(out.map((value) => Math.min(1, value).toFixed(5)).join(' '));
      }
    }
  }

  return `${rows.join('\n')}\n`;
}

// The talking-head stand-in: a blurred, dimmed desk with the line's own waveform drawn over it.
function voiceClip(library: string): CommandFixture {
  const graph =
    '[0:v]scale=640:360,boxblur=10,eq=brightness=-0.18[bg];[1:a]asplit[a][w];' +
    '[w]showwaves=s=640x140:mode=cline:rate=30:colors=white@0.85[wave];[bg][wave]overlay=0:200[v]';

  return {
    file: 'voice.mp4',
    args: [
      '-loop',
      '1',
      '-framerate',
      '30',
      '-i',
      `${library}/backgrounds/laptop-desk.jpg`,
      '-f',
      'lavfi',
      '-i',
      VOICE,
      '-filter_complex',
      graph,
      '-map',
      '[v]',
      '-map',
      '[a]',
      ...H264,
      ...AAC,
      '-t',
      SECONDS,
    ],
  };
}

const PUSH_IN = "zoompan=z='1+0.0012*on':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=640x360:fps=30";

/** The fixture `id` (generated media for a recorded scene or a media variable), built from `library`. */
export function syntheticFixture(id: string, library: string): SyntheticFixture {
  const fixtures: Record<string, () => SyntheticFixture> = {
    // Vertical clip for fit "blur" in a landscape frame: a slow climb up the forest.
    portrait: () =>
      photoClip(
        library,
        'portrait.mp4',
        'green-forest.jpg',
        "scale=-2:1280,crop=360:640:x='(iw-360)/2':y='(ih-640)*t/8'"
      ),
    // Wide clip so a keyframed focus visibly pans the cover crop.
    panorama: () => photoClip(library, 'panorama.mp4', 'rocky-coast.jpg', "scale=1920:-2,crop=1920:540:0:'200+8*t'"),
    // Golden hour drifting under a running clock: the ramp's slow section reads on the clock.
    timer: () =>
      photoClip(library, 'timer.mp4', 'golden-hour.jpg', `scale=800:-2,crop=640:360:x='20*t':y=40,${clock(library)}`),
    // A steady push-in with the clock for the freeze frame.
    zoom: () => photoClip(library, 'zoom.mp4', 'forest-sea.jpg', `scale=1280:-2,${PUSH_IN},${clock(library)}`),
    // Main footage under the cutaway, and the B-roll itself.
    main: () => photoClip(library, 'main.mp4', 'laptop-desk.jpg', `scale=1280:-2,${PUSH_IN}`),
    broll: () => photoClip(library, 'broll.mp4', 'desk-flatlay.jpg', "scale=800:-2,crop=640:360:x='160-20*t':y=40"),
    voice: () => voiceClip(library),
    lut: () => ({ file: 'warm-print.cube', text: warmCube() }),
  };

  return fixtures[id]();
}

/** Which fixtures stand in for a sample's recorded scenes (by section name) and media variables. */
const SAMPLE_SYNTHETIC: Record<string, SyntheticInputs> = {
  'footage-edit': {
    clips: { reframe: 'portrait', pan: 'panorama', ramp: 'timer', freeze: 'zoom', cutaway: 'main' },
    variables: { broll: 'broll', lut: 'lut' },
  },
  'sound-design': { clips: { voice: 'voice' } },
};

export function syntheticFor(sampleId: string): SyntheticInputs {
  return SAMPLE_SYNTHETIC[sampleId] ?? {};
}

export type Prerendered = { script: string; assets: string };

// Samples assembled from their own chapter renders: the script renders the chapter templates (with their
// generated clips) into `assets`, and the sample's descriptor plays those renders back as video sections.
const PRERENDERED: Record<string, Prerendered> = {
  'effects-tour': { script: 'examples/motion-design/effects-tour.sh', assets: 'build/effects-tour/assets' },
};

export function prerenderedFor(sampleId: string): Prerendered | undefined {
  return PRERENDERED[sampleId];
}

type RenderContext = { library: string; work: string; ffmpeg: (args: string[]) => unknown };
export type SyntheticMedia = { clips: Partial<Record<string, string>>; variables: Record<string, string> };

// Build a fixture once per run under <work>/fixtures and return its path.
async function fixturePath(id: string, ctx: RenderContext): Promise<string> {
  const fixture = syntheticFixture(id, ctx.library);
  const file = path.join(ctx.work, 'fixtures', fixture.file);

  if (existsSync(file)) return file;
  await mkdir(path.dirname(file), { recursive: true });

  if ('text' in fixture) {
    await writeFile(file, fixture.text);

    return file;
  }
  ctx.ffmpeg([...fixture.args, file]);

  return file;
}

async function resolveAll(map: Record<string, string> | undefined, ctx: RenderContext) {
  const entries = Object.entries(map ?? {});
  const files = await Promise.all(entries.map(([, id]) => fixturePath(id, ctx)));

  return Object.fromEntries(entries.map(([key], i) => [key, files[i]]));
}

/**
 * The generated clips standing in for a sample's recorded scenes, and the files its media variables
 * point at for this render. Variable media (cutaway URLs, LUTs) is copied under the sample's build
 * directory: the engine only reads local files from its staging directories.
 */
export async function prepareSynthetic(sampleId: string, ctx: RenderContext): Promise<SyntheticMedia> {
  const wanted = syntheticFor(sampleId);
  const staged = path.join(ctx.work, 'full', sampleId, 'media');
  const sources = await resolveAll(wanted.variables, ctx);
  await mkdir(staged, { recursive: true });
  const variables = Object.fromEntries(
    Object.entries(sources).map(([key, file]) => [key, path.join(staged, path.basename(file))])
  );
  await Promise.all(Object.entries(sources).map(([key, file]) => copyFile(file, variables[key])));

  return { clips: await resolveAll(wanted.clips, ctx), variables };
}

/** The descriptor rendered with its media variables pointed at the generated files (the saved JSON keeps its defaults). */
export function withVariables<T extends { global: { variables?: Record<string, unknown> } }>(
  template: T,
  variables: Record<string, string>
): T {
  if (Object.keys(variables).length === 0) return template;

  return { ...template, global: { ...template.global, variables: { ...template.global.variables, ...variables } } };
}

const PORTRAIT_SOURCE = 'packages/leclap-creative-kit/src/library/videos/video_portrait.mp4';
const MEDIA_LABELS: Record<string, string> = {
  evidence: 'Synthetic demo-shop captures and house cards',
  synthetic: 'Synthetic clips from bundled photos (FFmpeg) and lavfi audio',
  bundled: 'Bundled catalog / demo app fixtures',
};

/** The manifest's `mediaSource` / `media` provenance fields for a rendered sample. */
export function previewMedia(
  sample: { id: string; category: string },
  expanded: { global: { orientation?: string }; sections: Array<{ type: string }> },
  bundled: string | undefined
): { mediaSource?: string; media: string } {
  const synthetic = Object.keys(syntheticFor(sample.id)).length > 0 || prerenderedFor(sample.id) !== undefined;
  const recorded = expanded.sections.some((section) => section.type === 'project_video');
  const portrait = expanded.global.orientation === 'portrait' && recorded && !synthetic;
  const kind = synthetic ? 'synthetic' : 'bundled';

  return {
    mediaSource: bundled ?? (portrait ? PORTRAIT_SOURCE : undefined),
    media: MEDIA_LABELS[sample.category === 'evidence' ? 'evidence' : kind],
  };
}
