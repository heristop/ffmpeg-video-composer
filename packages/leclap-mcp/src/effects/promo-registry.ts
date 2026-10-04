import { z } from 'zod';
export const PROMO_EFFECT_ID = 'leclap.web-app-promo';
export const PROMO_EFFECT_VERSION = '1.0.0';
export const PROMO_COMPOSITION_ID = 'LeclapWebAppPromo';
function text(max: number) {
  return z.string().trim().min(1).max(max);
}
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const promoPropsSchema = z
  .object({
    brand: text(24).default('LeClap'),
    eyebrow: text(40).default('FROM IDEA TO LAUNCH'),
    headline: text(56).default('Your next big idea. In motion.'),
    subheadline: text(110).default('Turn your product into a story worth watching.'),
    cta: text(28).default('Start creating'),
    displayUrl: text(60).default('leclap.dev'),
    features: z
      .array(text(32))
      .length(3)
      .default(['Design with intent', 'Move with precision', 'Ship something remarkable']),
    accent: hex.default('#B9A2FF'),
    backgroundColor: hex.default('#111120'),
    textColor: hex.default('#FFFFFF'),
    showcaseStartFrame: z.number().int().min(60).max(150).default(90),
    ctaStartFrame: z.number().int().min(210).max(260).default(240),
    entranceDurationFrames: z.number().int().min(12).max(36).default(24),
    springDamping: z.number().min(8).max(40).default(20),
    cameraZoom: z.number().min(1).max(1.15).default(1.06),
    cameraTiltDegrees: z.number().min(0).max(12).default(8),
  })
  .strict()
  .refine((props) => props.ctaStartFrame - props.showcaseStartFrame >= 90, {
    message: 'CTA must start at least 90 frames after the showcase.',
  });
export const promoAssetsSchema = z
  .object({ screenshot: z.string().min(1), logo: z.string().min(1), font: z.string().min(1) })
  .strict();
export type PromoProps = z.infer<typeof promoPropsSchema>;
