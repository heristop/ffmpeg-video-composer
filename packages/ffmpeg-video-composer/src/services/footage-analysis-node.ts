// Node-only footage analysis (core/footage/analyzer.ts): `silencedetect` over a clip's audio, run once
// per file content + parameters, and the build's filter list (`ffmpeg -filters`), probed once per binary.
// Never imported by the browser or React Native entries.

import type { FootageAnalyzer } from '@/core/footage/analyzer';
import { parseSilencedetect, silencedetectFilter, type SilenceSpan } from '@/core/footage/keep-ranges';
import { runMeasurement } from '../platform/ffmpeg/analyze-node';
import { fileDigest } from './command-inputs-node';

const silenceCache = new Map<string, Promise<SilenceSpan[]>>();
const filterLists = new Map<string, Promise<Set<string>>>();

/** Filter names from `ffmpeg -filters` output (` T.C name  A->A  description`). */
export function parseFilterList(stdout: string): Set<string> {
  const names = new Set<string>();

  for (const line of stdout.split('\n')) {
    const match = /^\s[.A-Z|]{3}\s+(\w+)\s+\S+->\S+/.exec(line);

    if (match) names.add(match[1]);
  }

  return names;
}

function filterList(ffmpeg: string): Promise<Set<string>> {
  const cached = filterLists.get(ffmpeg);

  if (cached) return cached;

  const pending = runMeasurement(ffmpeg, ['-hide_banner', '-filters'])
    .then(({ stdout }) => parseFilterList(stdout))
    .catch(() => new Set<string>());
  filterLists.set(ffmpeg, pending);

  return pending;
}

async function detectSilences(ffmpeg: string, file: string, filter: string): Promise<SilenceSpan[]> {
  const { stderr } = await runMeasurement(ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-map',
    '0:a:0',
    '-af',
    filter,
    '-f',
    'null',
    '-',
  ]);

  return parseSilencedetect(stderr);
}

export function createFootageAnalyzer(ffmpeg: string): FootageAnalyzer {
  return {
    async silences(file, params) {
      const filter = silencedetectFilter(params);
      const key = `${ffmpeg}\n${await fileDigest(file)}\n${filter}`;
      const cached = silenceCache.get(key);

      if (cached) return cached;

      const pending = detectSilences(ffmpeg, file, filter);
      silenceCache.set(key, pending);
      pending.catch(() => silenceCache.delete(key));

      return pending;
    },
    async hasFilters(names) {
      const available = await filterList(ffmpeg);

      return names.every((name) => available.has(name));
    },
  };
}
