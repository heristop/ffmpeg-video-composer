import { z } from 'zod';
import { TranslationSchema } from './global.schemas';
import { TimedRevealSchema, TimedExitSchema } from './reveal.schemas';
import { AnimateSchema, MotionRoleSchema } from './motion.schemas';
import { ElementIdSchema } from './time.schemas';

// ── filter schemas ─────────────────────────────────────────────────────────────

export const FilterValuesSchema = z
  .object({
    h: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Height parameter passed to the FFmpeg filter (pixels or expression).'),
    w: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Width parameter passed to the FFmpeg filter (pixels or expression).'),
    x: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Horizontal offset parameter passed to the FFmpeg filter.'),
    y: z.union([z.number(), z.string()]).optional().describe('Vertical offset parameter passed to the FFmpeg filter.'),
    c: z.string().optional().describe('Colour parameter passed to the FFmpeg filter (e.g. for drawbox).'),
    t: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Time or thickness parameter passed to the FFmpeg filter.'),
    text: TranslationSchema.optional().describe('Localised text rendered by the filter (e.g. for drawtext).'),
    fontcolor: z
      .string()
      .optional()
      .describe('Font colour passed to the drawtext filter, as a CSS hex string or FFmpeg colour name.'),
    fontsize: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Font size in pixels or as an FFmpeg expression passed to the drawtext filter.'),
    fontfile: z.string().optional().describe('Path or URL to the font file used by the drawtext filter.'),
    box: z
      .union([z.number(), z.string()])
      .optional()
      .describe('drawtext background box toggle (1 draws a box behind the text).'),
    boxcolor: z
      .string()
      .optional()
      .describe('drawtext background box colour token, e.g. "#000000@0.5" (the @suffix is the opacity).'),
    boxborderw: z
      .union([z.number(), z.string()])
      .optional()
      .describe(
        'drawtext background box padding in pixels around the text; FFmpeg n8.0 also accepts per-side "up|right|down|left" strings.'
      ),
    shadowcolor: z.string().optional().describe('drawtext drop-shadow colour token, e.g. "#000000@0.6".'),
    shadowx: z.union([z.number(), z.string()]).optional().describe('drawtext drop-shadow horizontal offset in pixels.'),
    shadowy: z.union([z.number(), z.string()]).optional().describe('drawtext drop-shadow vertical offset in pixels.'),
    bordercolor: z.string().optional().describe('drawtext outline colour token, e.g. "#000000".'),
    borderw: z.union([z.number(), z.string()]).optional().describe('drawtext outline width in pixels.'),
    alpha: z.string().optional().describe('Alpha (opacity) expression passed to the filter.'),
    d: z.string().optional().describe('Duration parameter passed to the FFmpeg filter in seconds.'),
    st: z.string().optional().describe('Start time parameter passed to the FFmpeg filter in seconds.'),
    color: z.string().optional().describe('Alternate colour parameter (some filters use "color" instead of "c").'),
    enable: z
      .string()
      .optional()
      .describe(
        "Timeline gate expression forwarded to the filter's enable option, pre-quoted when it holds commas (e.g. \"'gte(t,0.3)'\")."
      ),
  })
  .describe('Key-value filter parameters forwarded verbatim to the corresponding FFmpeg filter.');

export const FilterSchema = z
  .object({
    type: z
      .string()
      .describe(
        'Raw FFmpeg filter name passed through verbatim (e.g. drawtext, drawbox, fade); determines which filter is applied.'
      ),
    value: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        'Single scalar parameter for simple filters. For scale, the LeClap shorthand output preserves aspect and pads the completed scene to videoConfig.scale.'
      ),
    values: FilterValuesSchema.optional().describe('Structured parameters for multi-argument filters.'),
    range: z.string().optional().describe('Time range over which the filter is active, as "start:end" in seconds.'),
    id: ElementIdSchema.optional().describe(
      'Id of a drawtext filter for time references: "<id>.start" is its reveal delay, "<id>.end" when its entrance has landed.'
    ),
    reveal: TimedRevealSchema.optional().describe(
      'Animated entrance for a drawtext filter; baked to alpha + kinetic x/y at compile.'
    ),
    exit: TimedExitSchema.optional().describe(
      'Animated exit for a drawtext filter; baked alongside the entrance at compile.'
    ),
    animate: AnimateSchema.optional(),
    role: MotionRoleSchema.optional().describe(
      'Motion role of a drawtext filter: fills reveal/exit easing (and duration) and animate key eases it leaves unset.'
    ),
  })
  .describe('A single FFmpeg filter applied to the section or input stream.');

export const MapOptionsSchema = z
  .object({
    useSectionFilters: z
      .boolean()
      .optional()
      .describe("When true, the section-level filters are applied inside this map's filter chain (default false)."),
  })
  .describe('Behavioural options for a map entry.');

export const MapSchema = z
  .object({
    inputs: z.array(z.string()).describe("Ordered list of input stream labels fed into this map's filter graph."),
    outputs: z.array(z.string()).describe("Ordered list of output stream labels produced by this map's filter graph."),
    filters: z.array(FilterSchema).optional().describe('Filter chain applied between the map inputs and outputs.'),
    options: MapOptionsSchema.optional().describe('Additional behavioural options for this map.'),
  })
  .describe('An FFmpeg filtergraph map connecting named input streams to output streams via an optional filter chain.');
