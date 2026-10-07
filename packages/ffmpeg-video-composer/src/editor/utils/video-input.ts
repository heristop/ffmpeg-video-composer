// A video source for the post-render audio passes: either an already-assembled file, or the concat
// demuxer list (so the audio pass concatenates and stream-copies video in one invocation instead of
// running a separate concat pass first). See docs/perf-findings.md (fold concat into the audio pass).
import { uniqueTempSuffix } from '../../utils/temp-suffix';

export type VideoSource = { kind: 'file'; path: string } | { kind: 'concat'; listPath: string };

export function buildVideoInputArgs(source: VideoSource): string {
  if (source.kind === 'concat') {
    return `-f concat -safe 0 -auto_convert 1 -i ${source.listPath}`;
  }

  return `-i ${source.path}`;
}

// First file path referenced by a concat-demuxer list (`file '<path>'` lines), or null when empty.
// Used to probe the assembled stream's properties without materialising the concatenated file.
export function firstConcatEntry(listContents: string): string | null {
  const first = listContents.split('\n').find((line) => line.trim().length > 0);

  if (!first) {
    return null;
  }

  return first.replace(/^file\s+'?|'?$/g, '').trim();
}

// Minimal filesystem surface the resolver needs (satisfied by AbstractFilesystem).
export interface VideoInputFs {
  read(path: string): Promise<string>;
  move(from: string, to: string): Promise<void>;
  getTempDir(): string | undefined;
}

// Resolve a VideoSource to ffmpeg input args + a probe target. A file source is moved aside to a
// temp (freeing the output path) and probed directly; a concat source streams the list into the
// demuxer (no move) and probes its first entry. Shared by the music + normalize audio passes.
export async function resolveVideoInput(
  source: VideoSource,
  fs: VideoInputFs,
  tempPrefix: string
): Promise<{ videoInputArgs: string; probeTarget: string; tempToClean: string | null }> {
  if (source.kind === 'concat') {
    const first = firstConcatEntry(await fs.read(source.listPath));

    if (!first) {
      throw new Error('[VideoInput] Empty concat list');
    }

    return { videoInputArgs: buildVideoInputArgs(source), probeTarget: first, tempToClean: null };
  }

  const temp = `${fs.getTempDir()}/${tempPrefix}_${uniqueTempSuffix()}.mp4`;
  await fs.move(source.path, temp);

  return { videoInputArgs: buildVideoInputArgs({ kind: 'file', path: temp }), probeTarget: temp, tempToClean: temp };
}
