// Advisories for complex scripts and masks, riding on the motion-warning channel (getMotionWarnings):
// - kinetic_unit_coarsened (always): a word/glyph kinetic block whose copy joins or runs right-to-left
//   is drawn a line at a time, so its per-unit choreography collapses to one unit per line;
// - rtl_unshaped / mask_unavailable (only when the caller names the target build's capabilities): the
//   build can't reorder right-to-left lines (no libfribidi) or can't draw kinetic fills, masks or track mattes (no alphamerge);
// - caption_html_unavailable (only when the caller says the host has no HTML rasteriser): subtitles asking
//   for the html renderer are drawn with drawbox there.
// Blend/motion-blur advisories (composite-lint.ts) are appended here too.
// Render-free and never errors, like the pacing lint.

import { expandPartialsSafe } from '@/core/partials';
import { hasRtl, textValues } from '@/core/text-scripts';
import { coarsenedForScript } from '@/core/kinetic/resolve';
import { collectCompositeWarnings } from './composite-lint';
import type { KineticBlock } from '../schemas/kinetic.schemas';
import type { MotionWarning } from './motion-lint';
import { maskAdvisories } from './mask-advisories';

/** What the target FFmpeg build can do, for the capability-dependent advisories. */
export interface ScriptLintCapabilities {
  /** drawtext text_shaping (libfribidi). */
  textShaping: boolean;
  /** alphamerge (kinetic fills, masks and track mattes). */
  masks: boolean;
  /** An HTML rasteriser on the host (HTML layers, subtitles.renderer "html"). Unset = assumed present. */
  htmlLayers?: boolean;
  /** blend (layer blend modes); unknown when omitted. */
  blend?: boolean;
  /** tmix (motion blur); unknown when omitted. */
  tmix?: boolean;
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

// HTML captions fall back to drawbox on a host without an HTML rasteriser: same layout, plainer look.
function htmlCaptionWarnings(template: unknown, caps: ScriptLintCapabilities | undefined): MotionWarning[] {
  if (caps?.htmlLayers !== false) return [];

  const sections = (template as { sections?: Array<{ subtitles?: { renderer?: string } }> } | null)?.sections ?? [];

  return sections.flatMap((section, index) =>
    section.subtitles?.renderer === 'html'
      ? [
          {
            path: `sections[${index}].subtitles.renderer`,
            code: 'caption_html_unavailable',
            severity: 'warn' as const,
            message: 'this host draws no HTML layers: these captions fall back to drawbox',
            hint: 'Register an HTML rasteriser on the host, or use renderer "drawbox".',
          },
        ]
      : []
  );
}

export function collectScriptWarnings(template: unknown, caps?: ScriptLintCapabilities): MotionWarning[] {
  const expansion = expandPartialsSafe(template);

  if (!expansion.ok) return [];

  return [
    ...kineticSites(expansion.data).flatMap((site) => [
      ...coarsened(site),
      ...(caps ? capabilityWarnings(site, caps) : []),
    ]),
    ...htmlCaptionWarnings(expansion.data, caps),
    ...collectCompositeWarnings(expansion.data, caps),
    ...(caps ? maskAdvisories(expansion.data, caps) : []),
  ];
}
