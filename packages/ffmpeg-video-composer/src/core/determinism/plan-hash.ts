// The plan hash: one digest naming everything that decides a render's bytes before any frame is
// encoded — the canonical template, the content of every asset and font it uses, the encoder/quality
// configuration, the engine version and the exact FFmpeg build. Two renders with the same plan hash on
// the same platform profile are expected to be byte-identical (determinism contract, D5/D7). Pure: the
// caller supplies the file digests.

import { canonicalJson } from './hash';
import { sha256Hex } from './sha256';

export const PLAN_HASH_SCHEMA = 'leclap-plan/1';

export interface PlanHashInput {
  descriptor: unknown;
  /** SHA-256 of every source asset (clips, images, overlays, LUTs, music). */
  assetDigests: readonly string[];
  /** SHA-256 of every font file the drawtext filters load. */
  fontDigests: readonly string[];
  /** The render-relevant encoder/quality configuration (codecs, tier, preset, profile, video/audio config). */
  encoder: Record<string, unknown>;
  engineVersion: string;
  /** First line of `ffmpeg -version`; null when the build cannot be identified. */
  ffmpegVersion: string | null;
}

function sorted(digests: readonly string[]): string[] {
  return [...new Set(digests)].sort();
}

export function computePlanHash(input: PlanHashInput): string {
  return sha256Hex(
    [
      PLAN_HASH_SCHEMA,
      canonicalJson(input.descriptor),
      sorted(input.assetDigests).join(','),
      sorted(input.fontDigests).join(','),
      canonicalJson(input.encoder),
      input.engineVersion,
      input.ffmpegVersion ?? '',
    ].join('\n')
  );
}
