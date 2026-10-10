// A bundled (Metro) asset as a real file the engine can read. `Asset.fromModule(x).downloadAsync()` does not
// always give one: in an Android release build an image (it has a width and height) keeps its drawable
// resource name (`assets_backgrounds_cafetable`) as `localUri` and is marked downloaded, so React Native's
// <Image> can draw it, and nothing on disk has that name. A fresh Asset of the same source isn't marked, so
// its download goes through ExpoAsset's native module, which opens raw/drawable resources (and
// `file:///android_res/` ones) and copies them into the cache. Debug builds (Metro serves the asset over
// HTTP, downloaded into the cache) and iOS (the asset ships as a file in the app bundle) already get a file.
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

const toUri = (path: string): string => (path.startsWith('file://') ? path : `file://${path}`);

async function readableFile(uri: string | null | undefined): Promise<string | undefined> {
  if (!uri?.startsWith('file://')) return undefined;

  const info = await FileSystem.getInfoAsync(uri).catch(() => null);

  return info?.exists && !info.isDirectory ? uri : undefined;
}

/** The file:// URI of a readable copy of a bundled asset (the `require()`d module id). */
export async function bundledAssetFile(assetModule: number): Promise<string> {
  const asset = await Asset.fromModule(assetModule).downloadAsync();
  const local = await readableFile(asset.localUri);

  if (local) return local;

  const { name, type, hash, uri } = asset;
  const copy = await new Asset({ name, type, hash, uri }).downloadAsync();
  const copied = await readableFile(copy.localUri);

  if (copied) return copied;

  throw new Error(`the bundled asset ${name}.${type} has no readable file (${asset.localUri ?? uri})`);
}

/** Copies a bundled asset to `destination` (a path or file:// URI), unless a file is already there. */
export async function stageBundledAsset(assetModule: number, destination: string): Promise<void> {
  const to = toUri(destination);

  if (await readableFile(to)) return;

  await FileSystem.copyAsync({ from: await bundledAssetFile(assetModule), to });
}
