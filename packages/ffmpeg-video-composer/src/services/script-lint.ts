// Advisories for complex scripts and masks, riding on the motion-warning channel (getMotionWarnings):
// - kinetic_unit_coarsened (always): a word/glyph kinetic block whose copy joins or runs right-to-left
//   is drawn a line at a time, so its per-unit choreography collapses to one unit per line;
// - rtl_unshaped / mask_unavailable (only when the caller names the target build's capabilities): the
//   build can't reorder right-to-left lines (no libfribidi) or can't draw kinetic fills (no alphamerge).
// Render-free and never errors, like the pacing lint.

import { expandPartialsSafe } from '@/core/partials';
import { hasRtl, textValues } from '@/core/text-scripts';
import { coarsenedForScript } from '@/core/kinetic/resolve';
import type { KineticBlock } from '../schemas/kinetic.schemas';
import type { MotionWarning } from './motion-lint';

/** What the target FFmpeg build can do, for the capability-dependent advisories. */
export interface ScriptLintCapabilities {
  /** drawtext text_shaping (libfribidi). */
  textShaping: boolean;
  /** alphamerge (kinetic fills). */
  masks: boolean;
}

interface BlockSite {
  block: KineticBlock;
  path: string;
}

function kineticSites(template: unknown): BlockSite[] {
  const sections = (template as { sections?: Array<{ kinetic?: KineticBlock[] }> } | null)?.sections ?? [];

  return sections.flatMap((section, index) =>
    (section.kinetic ?? []).map((block, position) => ({ block, path: `sections[${index}].kinetic[${position}]` }))
  );
}

function coarsened({ block, path }: BlockSite): MotionWarning[] {
  const texts = block.preset === 'counter' ? [] : textValues(block.text);

  if (!texts.some((text) => coarsenedForScript(block, text))) return [];

  return [
    {
      path: `${path}.unit`,
      code: 'kinetic_unit_coarsened',
      severity: 'warn',
      message: `the copy is in a joining or right-to-left script, so "${block.preset}" animates whole lines, not ${block.unit ?? 'its default unit'}s`,
      hint: 'Set unit "line" and pick a line-friendly preset (rise, fade, slide, split) so the choreography reads as designed.',
    },
  ];
}

function capabilityWarnings({ block, path }: BlockSite, caps: ScriptLintCapabilities): MotionWarning[] {
  const warnings: MotionWarning[] = [];

  if (!caps.textShaping && textValues(block.text).some(hasRtl)) {
    warnings.push({
      path: `${path}.text`,
      code: 'rtl_unshaped',
      severity: 'warn',
      message:
        'right-to-left copy on an FFmpeg build without libfribidi: letters join but mixed-direction lines may read out of order',
      hint: 'Render with a build that links libfribidi (the on-device engine and most system FFmpeg do), or keep each line in one direction.',
    });
  }

  if (!caps.masks && block.fill) {
    warnings.push({
      path: `${path}.fill`,
      code: 'mask_unavailable',
      severity: 'warn',
      message: 'kinetic fill needs alphamerge, absent from the target build: the block renders in its solid colour',
      hint: 'Rebuild the on-device engine (scripts/ffmpeg/build-engine.sh) or keep `color` legible as the fallback.',
    });
  }

  return warnings;
}

export function collectScriptWarnings(template: unknown, caps?: ScriptLintCapabilities): MotionWarning[] {
  const expansion = expandPartialsSafe(template);

  if (!expansion.ok) return [];

  return kineticSites(expansion.data).flatMap((site) => [
    ...coarsened(site),
    ...(caps ? capabilityWarnings(site, caps) : []),
  ]);
}
