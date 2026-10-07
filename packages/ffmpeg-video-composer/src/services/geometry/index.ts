import { parseFontMetrics, type FontMetrics } from '@/core/font-metrics';
import { expandPartialsSafe } from '@/core/partials';
import { effectiveOrientation, resolvePlatform } from '@/core/platforms';
import { resolveThemeDescriptor } from '@/core/theme/resolve';
import type { TemplateDescriptor } from '../../schemas/template.schemas';
import {
  canvasFor,
  lowerTemplate,
  measureLayers,
  referencedFontFiles,
  type Box,
  type Canvas,
  type LoweredSection,
  type Panel,
} from './text-boxes';
import {
  collisionWarnings,
  contrastWarnings,
  coveredTextWarnings,
  footageLegibilityWarnings,
  legibilityWarnings,
  overflowWarnings,
  type GeometryWarning,
} from './rules';
import { platformWarnings } from './platform-rules';
// FontLoader lives in bundled-font-loader.ts, not here, so this barrel only ever imports *from* that
// module — never the reverse — keeping the re-export of `createBundledFontLoader` below cycle-free.
import type { FontLoader } from './bundled-font-loader';

export type { GeometryWarning, GeometryApproxReason } from './rules';
export { createBundledFontLoader, type FontLoader } from './bundled-font-loader';

// Past this, the report stops being read and starts being scrolled past. The first twenty findings
// are the ones worth acting on.
const MAX_WARNINGS = 20;

// Worst first, so the cut above keeps the findings worth acting on. A video longer than its delivery
// platform accepts cannot be posted at all; text off the frame edge is simply not on screen; a
// collision is two things fighting for one place; text under an app's UI is hidden for every viewer;
// an overflow only risks a crop; the rest are legibility hints, a contrast measured from rendered
// pixels ahead of one computed from colour tokens. Anything unranked sorts last rather than throwing the order away.
const SEVERITY_ORDER = [
  'platform_duration_exceeded',
  'text_out_of_frame',
  'text_collision',
  'text_covered',
  'platform_ui_overlap',
  'text_overflow',
  'platform_orientation_mismatch',
  'platform_fps_mismatch',
  'text_low_contrast_rendered',
  'text_low_contrast',
  'text_too_small',
  'text_unreadable_over_footage',
];

function severityRank(warning: GeometryWarning): number {
  const rank = SEVERITY_ORDER.indexOf(warning.code);

  return rank === -1 ? SEVERITY_ORDER.length : rank;
}

// Load and parse each font file once. A loader that returns null, yields bytes that will not parse,
// or throws outright all land in the same place: no metrics for that file, so its boxes fall back to
// the approximation and every warning drawn from them is flagged `approx`. Validation is advisory
// and must never be the thing that fails.
async function loadMetrics(
  lowered: LoweredSection[],
  loadFont: FontLoader | undefined
): Promise<Map<string, FontMetrics>> {
  const resolved = new Map<string, FontMetrics>();

  if (!loadFont) {
    return resolved;
  }

  // Keyed on the FILE the filters draw with, so each typeface is read and parsed once.
  const files = referencedFontFiles(lowered);
  const parsed = await Promise.all(files.map((file) => parseOne(loadFont, file)));

  for (const [index, file] of files.entries()) {
    const metrics = parsed[index];

    if (metrics) {
      resolved.set(file, metrics);
    }
  }

  return resolved;
}

async function parseOne(loadFont: FontLoader, file: string): Promise<FontMetrics | null> {
  try {
    const bytes = await loadFont(file);

    return bytes ? parseFontMetrics(bytes) : null;
  } catch {
    return null;
  }
}

// Partials are expanded here rather than left to the caller, for the same reason `validateTemplate`
// expands them: a `{ type: "partial", ref }` section carries no caption or lowerThird of its own, so
// measuring the raw descriptor reported a clean bill of health for everything the partial contains —
// and six of the nine bundled templates are partial-based. An unexpandable descriptor is measured
// as-is: this channel is advisory, and `validateTemplate` is what reports the broken ref.
// Theme tokens are resolved too, so `$color.fg` is measured as the colour it renders.
function expanded(template: TemplateDescriptor): TemplateDescriptor {
  const expansion = expandPartialsSafe(template);

  return expansion.ok ? resolveThemeDescriptor(expansion.data as TemplateDescriptor) : template;
}

interface LoosePartialRef {
  type?: unknown;
  ref?: unknown;
}

// Where the sections a `{ type: "partial" }` entry expands into are AUTHORED, mirroring
// expandRefSection's choice of source: the registry partial its `ref` names — the last one with that
// id, as `partialsById` keeps — when that partial has sections, otherwise the entry's own inline
// `sections`. Only there does an edit take effect: expansion discards anything set on the ref itself,
// so a finding addressed to `sections[i].caption` sent an agent to add a caption the renderer throws
// away, and the same finding came back.
function partialSourcePath(raw: TemplateDescriptor, entry: LoosePartialRef, index: number): string {
  const ref = typeof entry.ref === 'string' ? entry.ref.trim() : '';
  const registry: ({ id?: unknown; sections?: unknown } | null | undefined)[] = Array.isArray(raw.partials)
    ? raw.partials
    : [];
  let found = -1;

  for (const [position, partial] of registry.entries()) {
    found = ref !== '' && partial?.id === ref ? position : found;
  }

  return found === -1 || !Array.isArray(registry[found]?.sections)
    ? `sections[${index}].sections`
    : `partials[${found}].sections`;
}

// Where the author edits each EXPANDED section.
//
// `path` is what an MCP agent edits against, so it has to address the descriptor the author holds,
// not the one the model measured. Expansion splices a partial's sections inline, shifting every
// later index — a caption authored at `sections[1]` behind a three-section partial was reported at
// `sections[3]`, which is either the wrong section or none at all.
//
// Rebuilt through the public API rather than by threading provenance through `partials.ts`:
// expansion maps each authored section to 0..n expanded ones *in order*, so expanding one authored
// section at a time (against the same descriptor, so its `partials` registry still resolves) yields
// the counts, and a partial's k-th expanded section is its source's k-th section.
function authoredPaths(raw: TemplateDescriptor, expandedCount: number): string[] {
  const authored: unknown[] = Array.isArray(raw.sections) ? raw.sections : [];
  const paths: string[] = [];

  for (const [index, section] of authored.entries()) {
    const one = expandPartialsSafe({ ...raw, sections: [section] });
    const produced = one.ok ? ((one.data as TemplateDescriptor).sections?.length ?? 0) : 1;
    const entry = (section ?? {}) as LoosePartialRef;
    const source = entry.type === 'partial' && one.ok ? partialSourcePath(raw, entry, index) : null;

    for (let k = 0; k < produced; k++) {
      paths.push(source === null ? `sections[${index}]` : `${source}[${k}]`);
    }
  }

  // A disagreement means the per-section walk and the whole-descriptor one diverged, which would
  // silently mis-address every finding. Identity is wrong in the same way the old code was, but it
  // is at least the failure everyone already reasons about.
  if (paths.length !== expandedCount) {
    return Array.from({ length: expandedCount }, (_, i) => `sections[${i}]`);
  }

  return paths;
}

// Every section repeats a global overlay, so its findings would repeat once per section.
function unique(findings: GeometryWarning[]): GeometryWarning[] {
  const seen = new Set<string>();

  return findings.filter((finding) => {
    const key = `${finding.code} ${finding.path} ${finding.message}`;
    const fresh = !seen.has(key);

    seen.add(key);

    return fresh;
  });
}

// A silent cut left an agent fixing twenty findings and meeting the next batch unannounced, so the
// last line says how many were left out. A finding like any other, so the CLI, `--json` and the MCP
// tool all carry it without a new field.
function truncated(findings: GeometryWarning[]): GeometryWarning[] {
  if (findings.length <= MAX_WARNINGS) {
    return findings;
  }

  const kept = findings.slice(0, MAX_WARNINGS - 1);
  const more = findings.length - kept.length;

  return [
    ...kept,
    {
      path: 'template',
      code: 'geometry_truncated',
      severity: 'warn',
      approx: false,
      message: `…and ${more} more finding(s) — showing the ${kept.length} most severe; fix these and validate again`,
    },
  ];
}

// Everything the rules read, for one descriptor: the expanded template, the lowered sections and
// the boxes and panels measured from them. Shared with the Node render check (render-check.ts),
// which needs the same boxes to know where and when to look.
export interface MeasuredTemplate {
  template: TemplateDescriptor;
  canvas: Canvas;
  lowered: LoweredSection[];
  boxes: Box[];
  panels: Panel[];
}

export async function measureTemplate(raw: TemplateDescriptor, loadFont?: FontLoader): Promise<MeasuredTemplate> {
  const template = expanded(raw);
  const canvas = canvasFor(effectiveOrientation(template.global));
  const origins = authoredPaths(raw, Array.isArray(template.sections) ? template.sections.length : 0);
  const lowered = lowerTemplate(template, canvas, origins);
  const metrics = await loadMetrics(lowered, loadFont);
  const { boxes, panels } = measureLayers(lowered, canvas, (font) => metrics.get(font) ?? null, template.global);

  return { template, canvas, lowered, boxes, panels };
}

// Every finding the static model supports, before de-duplication, ordering and the cut.
export function staticFindings({ template, lowered, boxes, panels, canvas }: MeasuredTemplate): GeometryWarning[] {
  const platform = resolvePlatform(template.global?.platform);

  return [
    ...platformWarnings(lowered, template.global, platform),
    ...overflowWarnings(boxes, canvas, platform),
    ...legibilityWarnings(boxes, canvas),
    ...contrastWarnings(boxes),
    ...footageLegibilityWarnings(boxes),
    ...coveredTextWarnings(boxes, panels),
    // Capped at the whole budget rather than the remainder the earlier rules left, which starved it.
    ...collisionWarnings(boxes, MAX_WARNINGS + 1),
  ];
}

// Ordered by severity before truncating, so which findings survive the cut is a property of the
// findings rather than of rule order. `sort` is stable, so timeline order holds within a rank.
export function finalizeFindings(findings: GeometryWarning[]): GeometryWarning[] {
  return truncated(unique(findings).sort((a, b) => severityRank(a) - severityRank(b)));
}

export async function collectGeometryWarnings(
  raw: TemplateDescriptor,
  loadFont?: FontLoader
): Promise<GeometryWarning[]> {
  return finalizeFindings(staticFindings(await measureTemplate(raw, loadFont)));
}
