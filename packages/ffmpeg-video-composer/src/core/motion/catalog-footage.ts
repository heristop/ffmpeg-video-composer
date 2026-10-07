// Recorded-footage vocabulary for agents (motionCatalog().footage): grading strength and user LUTs,
// silence trimming, explicit keep windows, B-roll cutaways and what the engine does with probed traits.

import { LUT_LOOK_PRESETS } from '../../schemas/effects-visual.schemas';
import { footageCatalog, type FootageCatalog } from '../footage/presets';

export const FOOTAGE_GUIDE = {
  look: {
    lutPresets: LUT_LOOK_PRESETS,
    example: { look: { preset: 'teal-orange', strength: 0.6 } },
    rules: [
      'strength (0..1) dials a LUT look toward the untouched footage; it is baked into one generated .cube.',
      'Only the LUT looks take strength; the eq/colour-balance looks are full strength.',
    ],
  },
  gradeLut: {
    example: { grade: { lut: { url: 'luts/slog3-to-709.cube', strength: 1 } } },
    rules: [
      'A user 3D .cube (Log → Rec.709, a colourist grade) runs first in the grade, before eq/balance/curves.',
      'Malformed cubes fail the section with the offending line (LUT_3D_SIZE, row count, DOMAIN_MIN < DOMAIN_MAX).',
    ],
  },
  trimSilence: {
    example: { options: { trimSilence: { gaps: { minSilence: 0.6, margin: 0.15, threshold: -35 } } } },
    rules: [
      'Cuts silence before the first and after the last word (edges, default on); gaps:{} also cuts long pauses.',
      'Pauses shorter than minSilence are never cut; margin seconds of each pause stay next to the speech.',
      'Node only (silencedetect). The section length then depends on the analysis: section-relative and beat ' +
        'references after it cannot resolve. On browser/device pass the windows as options.keep.',
    ],
  },
  keep: {
    example: {
      options: {
        keep: [
          [0.4, 3.2],
          [4.1, 9.8],
        ],
      },
    },
    rules: [
      'Source windows [from, to], ascending and non-overlapping; joined back to back on every backend.',
      'keep / trimSilence / cutaways do not combine with clip / speedRamp / freeze on one section.',
    ],
  },
  cutaways: {
    example: { cutaways: [{ url: 'videos/broll.mp4', at: 'cue:product', duration: 2.5, audio: 'a', fit: 'cover' }] },
    rules: [
      'The main clip keeps running underneath; at is section time (after trimming) or a time reference.',
      'audio: a keeps the main sound (voice-over on B-roll), b switches to the cutaway, mix sums both.',
      'One cutaway at a time: order by at, no overlaps, end inside the section.',
    ],
  },
  probe: [
    'probe_media reports hdr (pq/hlg/dolby-vision), colorPrimaries/colorTransfer, bitDepth, vfr and rotation.',
    'HDR clips are tone-mapped to SDR when the FFmpeg build has zscale + tonemap; otherwise (and on device) the ' +
      'render logs hdr_source_sdr_pipeline: export or capture in SDR.',
    'VFR clips are conformed to the output fps; rotated clips are auto-rotated before framing.',
  ],
};

/** The whole footage vocabulary: fits, focus, ramps, clip range and freeze, plus take editing under `take`. */
export type FullFootageCatalog = FootageCatalog & { take: typeof FOOTAGE_GUIDE };

export function fullFootageCatalog(): FullFootageCatalog {
  return { ...footageCatalog(), take: FOOTAGE_GUIDE };
}
