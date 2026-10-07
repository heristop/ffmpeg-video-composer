import { z } from 'zod';
import { EasingSpecSchema } from './motion.schemas';

// Section layouts: several media in one frame. A split screen tiles panes side by side or stacked; a
// before/after shows one picture and wipes the other in. Both lower to crop/pad/overlay with per-frame
// expressions (no masks), so they render on every backend including the on-device engine.

export const LAYOUT_SECTION_TYPES = ['color_background', 'image_background', 'video', 'project_video'] as const;

const LayoutSourceSchema = z
  .string()
  .min(1)
  .describe(
    'A pane source: the name of another section (its pictureUrl, videoUrl, recorded clip or backgroundColor), ' +
      "this section's own name (its own background/clip), a media URL or path (.png/.jpg/.webp = still image, " +
      'anything else = video), or a #RRGGBB colour.'
  );

const DividerSchema = z
  .object({
    color: z.string().optional().describe('Divider colour (default #FFFFFF).'),
    width: z.number().positive().max(100).optional().describe('Divider thickness in px (default 4).'),
  })
  .strict()
  .describe('A solid line drawn along each pane boundary (or the wipe edge).');

export const SplitLayoutSchema = z
  .object({
    type: z.literal('split'),
    sources: z.array(LayoutSourceSchema).min(2).max(4).describe('2–4 pane sources, left→right or top→bottom.'),
    direction: z
      .enum(['horizontal', 'vertical'])
      .optional()
      .describe('horizontal: panes side by side (default); vertical: panes stacked top to bottom.'),
    ratio: z
      .number()
      .min(0.1)
      .max(0.9)
      .optional()
      .describe('Share of the frame the first pane takes with two panes (default 0.5); more panes split evenly.'),
    gap: z
      .number()
      .min(0)
      .max(400)
      .optional()
      .describe("Px between panes, showing the section's own background (default 0)."),
    divider: DividerSchema.optional(),
  })
  .strict()
  .describe('Split screen: every source cover-fitted into its pane.');

export const BeforeAfterLayoutSchema = z
  .object({
    type: z.literal('before-after'),
    before: LayoutSourceSchema.describe('Shown first, full frame.'),
    after: LayoutSourceSchema.describe('Revealed by the wipe, full frame.'),
    wipe: z
      .object({
        at: z.number().min(0).max(600).describe('Seconds from the section start when the wipe begins.'),
        duration: z.number().positive().max(30).optional().describe('Seconds the wipe takes (default 1).'),
        direction: z
          .enum(['right', 'left', 'down', 'up'])
          .optional()
          .describe('Way the edge travels: right = from the left edge rightwards (default).'),
        ease: EasingSpecSchema.optional().describe('Edge curve (default ease-in-out-cubic).'),
      })
      .strict()
      .describe('The moving edge revealing `after` over `before`.'),
    divider: DividerSchema.optional(),
  })
  .strict()
  .describe('Before/after: `before` full frame, then a wipe uncovers `after`.');

export const SectionLayoutSchema = z
  .discriminatedUnion('type', [SplitLayoutSchema, BeforeAfterLayoutSchema])
  .describe(
    'Several media in one frame, composited over the section background: a split screen or a before/after ' +
      'wipe. color_background, image_background, video and project_video sections only.'
  )
  .meta({ id: 'SectionLayout' });

export type SectionLayout = z.infer<typeof SectionLayoutSchema>;
export type SplitLayout = z.infer<typeof SplitLayoutSchema>;
export type BeforeAfterLayout = z.infer<typeof BeforeAfterLayoutSchema>;
