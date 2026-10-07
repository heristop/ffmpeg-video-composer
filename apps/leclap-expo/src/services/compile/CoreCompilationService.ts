import 'reflect-metadata';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
// Import the PRE-BUILT output (decorators compiled) — not the raw src — so Metro/Hermes never sees
// the core's tsyringe decorators. reflect-metadata is loaded once at the app entry (app/_layout.tsx).
import { compileReactNative, type NativeEngine } from 'ffmpeg-video-composer/reactnative';
import { renderQuip } from '@leclap/creative-kit/render-quips';
import {
  MUSIC_ASSETS,
  FONT_ASSETS,
  VIDEO_ASSETS,
  ANIMATION_ASSETS,
  BACKGROUND_ASSETS,
  EMOJI_ASSETS,
  findBackground,
} from '@/src/data/mediaCatalog';
import * as Leclap from '@/modules/leclap-ffmpeg';
import type { CompileInput, CompileOptions, CompileResult, CompileService } from './CompileService';

const toPath = (uri: string): string => uri.replace(/^file:\/\//, '');
const toUri = (p: string): string => (p.startsWith('file://') ? p : `file://${p}`);

// A fresh `-progress` file per command so a poll never reads a previous run's stale tail.
let progressCounter = 0;

// The native leclap-ffmpeg module IS the engine the reused core drives (run = ffmpeg, probe = ffprobe).
const engine: NativeEngine = {
  run: (args) => Leclap.run(args),
  probe: (args) => Leclap.probe(args),
  // M3 live progress: the core injects `-progress <path>` and polls it while the (blocking) native
  // run is in flight; ffmpeg writes the file at a real device path, we read it via expo-file-system.
  progressFilePath: () => `${toPath(FileSystem.cacheDirectory ?? '')}leclap-progress-${(progressCounter += 1)}.txt`,
  readTextFile: (path) => FileSystem.readAsStringAsync(toUri(path)).catch(() => ''),
};

// Stage the template's default bundled music into the assets dir so the core resolves it offline.
// The core looks for `${assetsDir}/musics/<name>.mp3` (MusicComposer.resolveCachedMusic), but a
// template ships `global.music: { name }` with no URL and Metro-bundles the track as an opaque asset
// id — not a plain filesystem path. Without staging, the on-device compile aborts with "Music URL is
// not provided." Tracks not in MUSIC_ASSETS (e.g. a `{ name, url }` entry) are left for the core to
// download from their URL.
async function stageBundledMusic(name: string | undefined, assetsDir: string): Promise<void> {
  if (!name) return;

  const fileName = name.endsWith('.mp3') ? name : `${name}.mp3`;

  if (!(fileName in MUSIC_ASSETS)) return;

  const assetModule = MUSIC_ASSETS[fileName];

  const destination = `${assetsDir}/musics/${fileName}`;

  if ((await FileSystem.getInfoAsync(toUri(destination))).exists) return;

  const asset = await Asset.fromModule(assetModule).downloadAsync();

  await FileSystem.makeDirectoryAsync(toUri(`${assetsDir}/musics`), { intermediates: true }).catch(() => {});
  await FileSystem.copyAsync({ from: toUri(asset.localUri ?? asset.uri), to: toUri(destination) });
}

// Stage the bundled drawtext fonts into `assetsDir/fonts` so the core resolves them locally
// (FilesystemExpoAdapter.resolveBundledFont). Without this, the engine falls back to the Google
// Fonts download, which can't resolve multi-word families (a `BebasNeue.ttf` filename → family
// "BebasNeue", not "Bebas Neue") → the font never lands → drawtext aborts with rc=-22. Idempotent.
async function stageBundledFonts(assetsDir: string): Promise<void> {
  const fontsDir = `${assetsDir}/fonts`;
  await FileSystem.makeDirectoryAsync(toUri(fontsDir), { intermediates: true }).catch(() => {});

  await Promise.all(
    Object.entries(FONT_ASSETS).map(async ([fileName, assetModule]) => {
      const destination = `${fontsDir}/${fileName}`;

      if ((await FileSystem.getInfoAsync(toUri(destination))).exists) return;

      const asset = await Asset.fromModule(assetModule).downloadAsync();
      await FileSystem.copyAsync({ from: toUri(asset.localUri ?? asset.uri), to: toUri(destination) });
    })
  );
}

// Stage the bundled colour emoji under `assetsDir/emoji`: the engine draws emoji in text as these
// images, resolving each as `/assets/emoji/<file>` (FilesystemExpoAdapter.resolveLocalAsset). The
// whole set is staged — emoji can come from form fields and partials, not just the descriptor — and
// each file is copied once (the existence check makes later compiles cheap). Idempotent.
async function stageBundledEmoji(assetsDir: string): Promise<void> {
  const emojiDir = `${assetsDir}/emoji`;
  await FileSystem.makeDirectoryAsync(toUri(emojiDir), { intermediates: true }).catch(() => {});

  await Promise.all(
    Object.entries(EMOJI_ASSETS).map(async ([fileName, assetModule]) => {
      const destination = `${emojiDir}/${fileName}`;

      if ((await FileSystem.getInfoAsync(toUri(destination))).exists) return;

      const asset = await Asset.fromModule(assetModule).downloadAsync();
      await FileSystem.copyAsync({ from: toUri(asset.localUri ?? asset.uri), to: toUri(destination) });
    })
  );
}

// Stage the bundled videos a template references by canonical URL (e.g. the brand bumper's
// `options.videoUrl`) under `assetsDir/videos` so the core resolves them locally
// (FilesystemExpoAdapter.resolveLocalAsset) instead of downloading the canonical URL — which on-device
// returns a 404 HTML page, so the engine fails the segment with AVERROR_INVALIDDATA. Staged
// unconditionally (the set is just the brand bumpers): a template's partials are still `ref`s at this point
// — the core expands them internally — so the descriptor's sections don't yet expose the videoUrl.
async function stageBundledVideos(assetsDir: string): Promise<void> {
  const videosDir = `${assetsDir}/videos`;
  await FileSystem.makeDirectoryAsync(toUri(videosDir), { intermediates: true }).catch(() => {});

  await Promise.all(
    Object.entries(VIDEO_ASSETS).map(async ([fileName, assetModule]) => {
      const destination = `${videosDir}/${fileName}`;

      if ((await FileSystem.getInfoAsync(toUri(destination))).exists) return;

      const asset = await Asset.fromModule(assetModule).downloadAsync();
      await FileSystem.copyAsync({ from: toUri(asset.localUri ?? asset.uri), to: toUri(destination) });
    })
  );
}

// Stage the animation overlays a template references — both section `inputs[]` of type 'animation' and
// whole-video `global.animations[]` — under `assetsDir/animations`, so the engine resolves them locally
// instead of downloading the canonical `/assets/animations/<file>` url (which 404s on-device). Section
// animations and global ones sit directly on the descriptor (already expanded, unlike partials), so it
// exposes them here; only the referenced files are staged — the .apng set is large.
async function stageBundledAnimations(descriptor: CompileInput['descriptor'], assetsDir: string): Promise<void> {
  const files = new Set<string>();

  const addFile = (url: string | undefined) => {
    const file = url?.split('/').pop();

    if (file && file in ANIMATION_ASSETS) files.add(file);
  };

  for (const section of descriptor.sections ?? []) {
    const inputs = (section as { inputs?: Array<{ type?: string; url?: string }> }).inputs ?? [];

    for (const input of inputs) {
      if (input.type === 'animation') addFile(input.url);
    }
  }

  // Whole-video overlays (global.animations[]) reference the same bundled .apng files but live off the
  // sections, so they need staging too or the final overlay pass 404s the canonical url on-device.
  const globalAnimations =
    (descriptor.global as { animations?: Array<{ url?: string }> } | undefined)?.animations ?? [];

  for (const animation of globalAnimations) addFile(animation.url);

  if (files.size === 0) return;

  const animationsDir = `${assetsDir}/animations`;
  await FileSystem.makeDirectoryAsync(toUri(animationsDir), { intermediates: true }).catch(() => {});

  await Promise.all(
    [...files].map(async (file) => {
      const destination = `${animationsDir}/${file}`;

      if ((await FileSystem.getInfoAsync(toUri(destination))).exists) return;

      const asset = await Asset.fromModule(ANIMATION_ASSETS[file]).downloadAsync();
      await FileSystem.copyAsync({ from: toUri(asset.localUri ?? asset.uri), to: toUri(destination) });
    })
  );
}

// Stage the still-image overlays a template references (visual-section `inputs[]` of type 'image')
// under `assetsDir/backgrounds`, then rewrite each input.url so the engine resolves the staged copy
// locally instead of trying to fetch the marker. Unlike animations (whose url is already the canonical
// `/assets/animations/<file>` path), an authored image-overlay input carries a `library://<id>` marker:
// we resolve `<id>` → the bundled background `<file>.jpg`, stage it, and rewrite the url to the canonical
// `/assets/backgrounds/<file>` path that FilesystemExpoAdapter.resolveLocalAsset maps to
// `${assetsDir}/backgrounds/<file>` (same convention as animations). Mirrors the web applyMediaChoices,
// which rewrites the same `library://` marker before materializing media. Expo image overlays are
// bundled-library only, so non-`library://` urls (none today) are left untouched. Mutates the descriptor.
// An image_background section carries its picture as a canonical `/assets/backgrounds/<file>.jpg`
// options.pictureUrl (already resolved, no marker). Return the bundled `<file>` when it points at a
// registered background — staging it is required or the render produces a broken output ffprobe
// rejects ("could not probe segment ... rc=1").
function backgroundPictureFile(section: unknown): string | undefined {
  const pictureUrl = (section as { options?: { pictureUrl?: string } }).options?.pictureUrl;

  if (!pictureUrl?.startsWith('/assets/backgrounds/')) return undefined;

  const file = pictureUrl.split('/').pop();

  return file && file in BACKGROUND_ASSETS ? file : undefined;
}

// An authored image-overlay input carries a `library://<id>` marker; resolve it to the bundled
// `<file>`, rewrite the input url to the canonical `/assets/backgrounds/<file>` path in place, and
// return the file to stage.
function libraryInputFile(input: { type?: string; url?: string }): string | undefined {
  if (input.type !== 'image' || !input.url?.startsWith('library://')) return undefined;

  const file = findBackground(input.url.slice('library://'.length))?.file;

  if (!file || !(file in BACKGROUND_ASSETS)) return undefined;

  input.url = `/assets/backgrounds/${file}`;

  return file;
}

// Every bundled background file the descriptor references (image_background pictureUrls + library://
// image inputs). Mutates library:// input urls to their canonical staged path.
function collectBundledImageFiles(descriptor: CompileInput['descriptor']): Set<string> {
  const files = new Set<string>();

  for (const section of descriptor.sections ?? []) {
    const pictureFile = backgroundPictureFile(section);

    if (pictureFile) files.add(pictureFile);

    const inputs = (section as { inputs?: Array<{ type?: string; url?: string }> }).inputs ?? [];

    for (const input of inputs) {
      const file = libraryInputFile(input);

      if (file) files.add(file);
    }
  }

  return files;
}

async function stageBundledImages(descriptor: CompileInput['descriptor'], assetsDir: string): Promise<void> {
  const files = collectBundledImageFiles(descriptor);

  if (files.size === 0) return;

  const backgroundsDir = `${assetsDir}/backgrounds`;
  await FileSystem.makeDirectoryAsync(toUri(backgroundsDir), { intermediates: true }).catch(() => {});

  await Promise.all(
    [...files].map(async (file) => {
      const destination = `${backgroundsDir}/${file}`;

      if ((await FileSystem.getInfoAsync(toUri(destination))).exists) return;

      const asset = await Asset.fromModule(BACKGROUND_ASSETS[file]).downloadAsync();
      await FileSystem.copyAsync({ from: toUri(asset.localUri ?? asset.uri), to: toUri(destination) });
    })
  );
}

// Stage the whole-video watermark image (descriptor global.watermark.url) under `assetsDir/backgrounds`,
// then rewrite the url so the engine resolves the staged copy locally instead of trying to fetch the
// marker. Mirrors stageBundledImages: only a `library://<id>` marker is staged — resolve <id> to the
// bundled background `<file>.jpg`, stage it, and rewrite to the canonical `/assets/backgrounds/<file>`
// path FilesystemExpoAdapter.resolveLocalAsset maps to `${assetsDir}/backgrounds/<file>`. A `url://`
// watermark (Expo's other authoring option, no upload — see watermark-fields.tsx) is left untouched;
// the core fetches it directly like any other remote URL. Without staging, a library watermark 404s
// on-device (AVERROR_INVALIDDATA). Mutates the descriptor.
async function stageBundledWatermark(descriptor: CompileInput['descriptor'], assetsDir: string): Promise<void> {
  const watermark = (descriptor.global as { watermark?: { url?: string } } | undefined)?.watermark;

  if (!watermark?.url?.startsWith('library://')) return;

  const file = findBackground(watermark.url.slice('library://'.length))?.file;

  if (!file || !(file in BACKGROUND_ASSETS)) return;

  watermark.url = `/assets/backgrounds/${file}`;

  const backgroundsDir = `${assetsDir}/backgrounds`;
  await FileSystem.makeDirectoryAsync(toUri(backgroundsDir), { intermediates: true }).catch(() => {});

  const destination = `${backgroundsDir}/${file}`;

  if ((await FileSystem.getInfoAsync(toUri(destination))).exists) return;

  const asset = await Asset.fromModule(BACKGROUND_ASSETS[file]).downloadAsync();
  await FileSystem.copyAsync({ from: toUri(asset.localUri ?? asset.uri), to: toUri(destination) });
}

// Prepare the on-device build/asset dirs and the ProjectConfig the core compiles against.
async function buildProjectConfig(input: CompileInput) {
  const { descriptor, clips, qualityTier } = input;
  const cache = toPath(FileSystem.cacheDirectory ?? '');
  const buildDir = `${cache}leclap-build`;
  const assetsDir = `${cache}leclap-assets`;

  await FileSystem.makeDirectoryAsync(toUri(buildDir), { intermediates: true }).catch(() => {});
  await stageBundledFonts(assetsDir);
  await stageBundledEmoji(assetsDir);
  await stageBundledMusic(descriptor.global?.music?.name, assetsDir);
  await stageBundledVideos(assetsDir);
  await stageBundledAnimations(descriptor, assetsDir);
  await stageBundledImages(descriptor, assetsDir);
  await stageBundledWatermark(descriptor, assetsDir);

  // Recorded clips, keyed by section name → the plain paths ffmpeg reads.
  const userVideoPaths: Record<string, string> = {};

  for (const [name, clip] of Object.entries(clips)) {
    userVideoPaths[name] = toPath(clip.path);
  }

  return {
    buildDir,
    assetsDir,
    fields: {},
    userVideoPaths,
    music: descriptor.global?.music,
    // On-device H.264, per platform (the LGPL build has no libx264/GPL). Android statically links
    // libopenh264 (Cisco, software) — real H.264 that works off the core's -filter_complex commands
    // (unlike the broken h264_mediacodec on emulator). iOS has no libopenh264; it encodes with Apple's
    // h264_videotoolbox (hardware, in the iOS build) — the core treats videotoolbox as a hardware
    // encoder (bitrate target, no libx264-only flags). Verified encoding on the simulator.
    codecConfig: {
      videoCodec: Platform.OS === 'ios' ? 'h264_videotoolbox' : 'libopenh264',
      audioCodec: 'aac',
    },
    hardwareConfig: { hwaccel: null, preset: 'medium' },
    ...(qualityTier ? { qualityTier } : {}),
  };
}

// The engine always writes the same build/output.mp4, so every render moves its result to a unique
// file. Otherwise an older project opened later would play the newest render, and export would
// save or share the wrong video.
async function publishOutput(outputPath: string): Promise<string> {
  const directory = `${FileSystem.cacheDirectory}leclap-outputs/`;
  const target = toUri(`${directory}${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);

  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.moveAsync({ from: toUri(outputPath), to: target });

  return target;
}

export class CoreCompilationService implements CompileService {
  async compile(input: CompileInput, options: CompileOptions = {}): Promise<CompileResult> {
    if (options.signal?.aborted) {
      return { success: false, error: 'Compilation cancelled.' };
    }

    const projectConfig = await buildProjectConfig(input);

    // Cooperative cancellation: ffmpeg exits as on SIGTERM, the failed run rejects inside
    // compileReactNative, and the catch below surfaces it as a failed compile.
    const onAbort = () => {
      Leclap.cancel();
    };

    options.signal?.addEventListener('abort', onAbort);

    try {
      const outputPath = await compileReactNative(
        projectConfig,
        input.descriptor as Parameters<typeof compileReactNative>[1],
        engine,
        (fraction) => options.onProgress?.({ ratio: fraction, stage: renderQuip(fraction) })
      );

      if (!outputPath) {
        return { success: false, error: 'Compilation produced no output.' };
      }

      const info = await FileSystem.getInfoAsync(toUri(outputPath));

      if (!info.exists || info.size === 0) {
        return { success: false, error: 'Compilation produced an empty output file.' };
      }

      const outputUri = await publishOutput(outputPath);

      options.onProgress?.({ ratio: 1, stage: 'Done' });

      return { success: true, outputUri };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
}
