// Shared shapes of the motion review harness: options, render jobs and the per-run manifest.

export type Format = 'landscape' | 'portrait' | 'square';
export type Background = 'footage' | 'dark' | 'light';

export const FORMATS: readonly Format[] = ['landscape', 'portrait', 'square'];
export const BACKGROUNDS: readonly Background[] = ['footage', 'dark', 'light'];

export const FRAME: Record<Format, { width: number; height: number }> = {
  landscape: { width: 1280, height: 720 },
  portrait: { width: 720, height: 1280 },
  square: { width: 1080, height: 1080 },
};

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface ReviewOptions {
  /** Output root: `<out>/<label>/…` plus the shared `index.html`. */
  out: string;
  /** Run label, the column of the index: `before` or `after` (or any name). */
  label: string;
  /** Git ref whose engine renders this run (built once into a cached worktree). */
  ref?: string;
  /** Real asset bundle (APNG, footage); LFS pointers inside it are detected and handled. */
  assets: string;
  effects: boolean;
  templates: boolean;
  /** Substring filters on fixture or template ids (any match keeps the job). */
  only: string[];
  formats: readonly Format[];
  backgrounds: readonly Background[];
  jobs: number;
  /** Rebuild the current tree's engine and CLI first. */
  build: boolean;
  /** A directory of existing PNG sheets shown in the index as "showcase baseline". */
  showcase?: string;
}

/** One `leclap snapshot` call: a descriptor, the moments to grab, and where the sheet lands. */
export interface RenderJob {
  /** Stable row key across runs: `<fixture>__<background>__<format>` or `template__<name>`. */
  key: string;
  group: 'effect' | 'template';
  title: string;
  kind: string;
  descriptor: JsonObject;
  at: (number | string)[];
  /** Extra CLI arguments (`--video section=path`). */
  args: string[];
  notes: string[];
  /** Set when nothing is worth rendering (every effect layer is an LFS pointer). */
  skip?: string;
}

export type JobStatus = 'ok' | 'skipped' | 'failed';

export interface ManifestEntry {
  key: string;
  group: RenderJob['group'];
  title: string;
  kind: string;
  status: JobStatus;
  /** Sheet path relative to the output root. */
  sheet?: string;
  frames: string[];
  notes: string[];
  error?: string;
  ms: number;
}

export interface RunManifest {
  label: string;
  engine: string;
  createdAt: string;
  entries: ManifestEntry[];
}
