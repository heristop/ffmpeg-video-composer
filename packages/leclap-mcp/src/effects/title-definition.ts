import { z } from 'zod';
export const TITLE_EFFECT_ID = 'leclap.title-reveal';
export const TITLE_EFFECT_VERSION = '1.0.0';
export const TITLE_COMPOSITION_ID = 'LeclapTitle';
export const titlePropsSchema = z
  .object({
    headline: z.string().trim().min(1).max(80).default('LECLAP'),
    headlineY: z.number().min(0).max(720).default(320),
    logoDelayFrames: z.number().int().min(0).max(299).default(15),
    entranceDurationFrames: z.number().int().min(1).max(300).default(24),
    springDamping: z.number().min(1).max(100).default(18),
  })
  .strict()
  .refine((props) => props.logoDelayFrames + props.entranceDurationFrames <= 300, {
    message: 'Logo entrance must finish within the 300-frame scene.',
  });
export const titleAssetsSchema = z
  .object({ background: z.string().min(1), logo: z.string().min(1), font: z.string().min(1) })
  .strict();
export type TitleProps = z.infer<typeof titlePropsSchema>;
