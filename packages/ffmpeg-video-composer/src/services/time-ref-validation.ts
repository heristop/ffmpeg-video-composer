// Descriptor rules for section-local time references ("title.end + 0.2", "50%", "end - 0.5", "beat:12",
// "cue:drop"): the same pass the build runs (core/timing/resolve.ts), on the template's own orientation
// and first locale, reported as validation errors.
//
// - unknown_time_ref: no element with that id, or no such cue, in the section (with a nearest-id hint).
// - circular_time_ref: a chain of references that comes back to itself.
// - unresolvable_time_ref: an anchor that cannot be known before rendering (no global.beats, a section
//   length or start that depends on a probed clip, a beat past the end of an explicit list).
// - negative_time: a reference that lands before the section starts.
// - duplicate_time_id: two elements of one section share an id.
// - beat_duration_needs_bpm: a section length in { beats } / { bars } without a bpm on global.beats.

import type { TemplateDescriptor } from '../schemas/template.schemas';
import { resolveMotionDescriptor } from '@/core/motion/tokens';
import { resolveTimeRefs } from '@/core/timing/resolve';
import { isAnalysisRequest } from '@/core/timing/timeline';

// Structurally the validator's ValidationError, with the optional hint (declared here so the rules
// module can import this one without a cycle).
interface ValidationError {
  path: string;
  message: string;
  code: string;
  hint?: string;
}

export function validateTimeRefs(template: TemplateDescriptor): ValidationError[] {
  // Tokens first, as in the build, so a "$snappy" ease measures like the spring it names.
  // A grid awaiting the music analysis defers its references: the Node compile measures it first, and
  // hosts that cannot are told by the validator's own beats_analysis_unavailable finding.
  const { issues } = resolveTimeRefs(resolveMotionDescriptor(template), { deferBeatsAnalysis: true });

  return issues.map(({ path, code, message, hint }) => ({ path, code, message, ...(hint && { hint }) }));
}

/**
 * beats_analysis_unavailable: `global.beats: { analyze: 'music' }` on a host that cannot decode and
 * measure music (the browser and on-device engines). The Node compile measures it before resolving.
 */
export function validateBeatsAnalysis(template: TemplateDescriptor, canAnalyze: boolean): ValidationError[] {
  if (canAnalyze || !isAnalysisRequest(template.global?.beats)) return [];

  return [
    {
      path: 'global.beats',
      code: 'beats_analysis_unavailable',
      message: 'global.beats { analyze: "music" } needs the Node compile: this engine cannot analyze music',
      hint:
        'precompute the grid with `leclap beats <audio> --json` or the analyze_music MCP tool and set ' +
        'global.beats to its { bpm, offset, beatsPerBar }',
    },
  ];
}
