import DefaultConfig from '@/core/default.config';
import type { FontMetrics } from '@/core/font-metrics';
import type { Section } from '@/core/types';
import { VIDEO_SEGMENT_TYPES } from '../../editor/utils/section-types';
import type { TemplateDescriptor } from '../../schemas/template.schemas';
import { sectionDrawLayers, type DrawLayer } from './draw-layers';
import { evaluateExpr } from './drawtext-expr';
import { anchoredSide, track } from './layer-track';
import type { Box, Canvas, Panel } from './geometry-types';
import { appearanceOver, panelFor } from './panels';
import { boxPaints, hasLegibilityAid, sectionBackdrop, type AppearanceGlobal } from './text-appearance';

export { canvasFor } from './canvas';
export type { Box, Canvas, Panel } from './geometry-types';
import { measure, type TextCaseOptions, type TextVariables } from './text-measure';

// When a section declares no duration the engine derives one at render time from the clip. Two
// seconds keeps later sections roughly ordered without pretending to know the real length.
const ASSUMED_DURATION_SEC = 2;

// drawtext has no leading of its own; the box height ascribed to one line at a given size.
const LINE_HEIGHT = 1.2;

// drawtext's default when a filter sets no size.
const DRAWTEXT_DEFAULT_FONT_SIZE = 16;

type LooseSection = Section & { options?: Section['options'] & TextCaseOptions };

// `Number.isFinite`, not `??`: a `duration: "abc"` from unvalidated input would otherwise make every
// later window NaN, and every NaN comparison false.
function declaredDuration(section: { options?: { duration?: number } }): number | null {
  const duration = section.options?.duration;

  return Number.isFinite(duration) ? (duration as number) : null;
}

// TemplateDirector renders only VIDEO_SEGMENT_TYPES; a `form` or `music` section's caption is never
// lowered to a filter, and its duration adds nothing to the output timeline. Effect sections
// become project_video before rendering; their downstream FFmpeg text layers are measurable here.
export function isRenderableSection(section: { type?: string }): boolean {
  return section.type === 'effect' || (section.type !== undefined && VIDEO_SEGMENT_TYPES.has(section.type));
}

// One renderable section, lowered: its place on the timeline and what it draws, in draw order.
export interface LoweredSection {
  section: LooseSection;
  sectionIndex: number;
  startSec: number;
  duration: number;
  timingAssumed: boolean;
  layers: DrawLayer[];
}

type TemplateGlobal = AppearanceGlobal & { variables?: TextVariables; overlays?: unknown };

// `origins[i]` is where the author edits expanded section `i` (see authoredPaths in ./index.ts).
export function lowerTemplate(template: TemplateDescriptor, canvas: Canvas, origins?: string[]): LoweredSection[] {
  const sections: (LooseSection | null | undefined)[] = Array.isArray(template.sections)
    ? (template.sections as unknown as LooseSection[])
    : [];
  const global = template.global as TemplateGlobal | undefined;
  const lowered: LoweredSection[] = [];
  let cursorSec = 0;
  let timingAssumed = false;

  for (const [index, section] of sections.entries()) {
    if (!section || !isRenderableSection(section)) {
      continue;
    }

    const declared = declaredDuration(section);
    // A negative duration must not rewind the cursor (unreachable from a validated descriptor).
    const duration = Math.max(declared ?? ASSUMED_DURATION_SEC, 0);
    // Sticky: once one window is a guess, every later start time is built on it.
    timingAssumed ||= declared === null;
    const ctx = {
      duration,
      scale: `${canvas.width}:${canvas.height}`,
      fps: DefaultConfig.FPS,
      isVideo: section.type === 'project_video' || section.type === 'video' || section.type === 'effect',
    };
    // Typed as required, but an unvalidated descriptor may omit it.
    const name: unknown = section.name;
    const label = `Section "${typeof name === 'string' ? name : `sections[${index}]`}"`;
    const owner = { path: origins?.[index] ?? `sections[${index}]`, label };

    lowered.push({
      section,
      sectionIndex: index,
      startSec: cursorSec,
      duration,
      timingAssumed,
      layers: sectionDrawLayers(section, global, ctx, owner),
    });
    cursorSec += duration;
  }

  return lowered;
}

// Every font file the lowered text draws with, so each is loaded and parsed once.
export function referencedFontFiles(lowered: LoweredSection[]): string[] {
  const files = lowered.flatMap((entry) =>
    entry.layers.filter((layer) => layer.kind === 'text').map((layer) => layer.values.fontfile)
  );

  return [...new Set(files.filter((file): file is string => typeof file === 'string'))];
}

interface Placement {
  entry: LoweredSection;
  canvas: Canvas;
  resolve: (font: string) => FontMetrics | null;
  variables: TextVariables | undefined;
}

function textBox(layer: DrawLayer, drawIndex: number, placement: Placement): Box | null {
  const { entry, canvas, resolve, variables } = placement;
  const values = layer.values;
  const frame = { w: canvas.width, h: canvas.height };
  const fontSize = evaluateExpr(values.fontsize ?? DRAWTEXT_DEFAULT_FONT_SIZE, frame);
  const fontFile = typeof values.fontfile === 'string' ? values.fontfile : null;

  if (fontSize === null || fontSize <= 0) {
    return null;
  }

  const measured = measure(
    values.text,
    fontSize,
    fontFile ? resolve(fontFile) : null,
    entry.section.options,
    variables
  );

  if (!measured) {
    return null;
  }

  const vars = { ...frame, text_w: measured.width, text_h: fontSize * LINE_HEIGHT * measured.lines };
  const position = track(values, vars, entry.duration);

  if (!position) {
    return null;
  }

  // drawtext anchors the GLYPH box; its background box then grows outward by `boxborderw`.
  const padding = boxPaints(values) ? (evaluateExpr(values.boxborderw ?? 0, frame) ?? 0) : 0;

  return {
    path: layer.path,
    label: layer.label,
    x: position.x - padding,
    y: position.y - padding,
    width: vars.text_w + padding * 2,
    height: vars.text_h + padding * 2,
    fontSize,
    startSec: entry.startSec + position.from,
    endSec: entry.startSec + position.to,
    settledSec: entry.startSec + position.at,
    timingAssumed: entry.timingAssumed,
    approx: measured.approx,
    approxReason: measured.approxReason,
    color: typeof values.fontcolor === 'string' ? values.fontcolor : null,
    backdrop: null,
    legibilityAid: hasLegibilityAid(values),
    verticalPositionAuthored: layer.authoredPosition,
    anchoredSide: anchoredSide(values, vars, vars.text_w, position.at),
    sectionIndex: entry.sectionIndex,
    drawIndex,
  };
}

export function measureLayers(
  lowered: LoweredSection[],
  canvas: Canvas,
  resolve: (font: string) => FontMetrics | null,
  global?: TemplateGlobal
): { boxes: Box[]; panels: Panel[] } {
  const boxes: Box[] = [];
  const panels: Panel[] = [];

  for (const entry of lowered) {
    const placement = { entry, canvas, resolve, variables: global?.variables };
    const base = sectionBackdrop(entry.section, global);
    const sectionPanels: Panel[] = [];

    for (const [drawIndex, layer] of entry.layers.entries()) {
      if (layer.kind === 'panel') {
        const panel = panelFor(layer, drawIndex, placement);

        if (panel) {
          sectionPanels.push(panel);
        }

        continue;
      }

      const box = textBox(layer, drawIndex, placement);

      if (box) {
        boxes.push({ ...box, ...appearanceOver(box, layer.values, sectionPanels, base) });
      }
    }

    panels.push(...sectionPanels);
  }

  // The collision sweep's early exit needs non-decreasing start times; a staggered reveal can start a
  // later-drawn line before an earlier one. `sort` is stable, so draw order holds within a start time.
  return { boxes: boxes.sort((a, b) => a.startSec - b.startSec), panels };
}

// The whole pass for one descriptor: lower it, then measure what it draws.
export function collectBoxes(
  template: TemplateDescriptor,
  canvas: Canvas,
  resolve: (font: string) => FontMetrics | null,
  origins?: string[]
): Box[] {
  return measureLayers(lowerTemplate(template, canvas, origins), canvas, resolve, template.global).boxes;
}
