import type { ImageSourcePropType } from 'react-native';

// Rendered sample stills. Keep these in sync with the showcase renders; user templates use a fallback.
export const templatePosters: Record<string, ImageSourcePropType | undefined> = {
  'app-tutorial': require('../../../assets/template-previews/app-tutorial.webp'),
  'fast-curious': require('../../../assets/template-previews/fast-curious.webp'),
  interview: require('../../../assets/template-previews/interview.webp'),
  'photo-backdrop': require('../../../assets/template-previews/photo-backdrop.webp'),
  'present-yourself': require('../../../assets/template-previews/present-yourself.webp'),
  'present-yourself-portrait': require('../../../assets/template-previews/present-yourself-portrait.webp'),
  'product-launch': require('../../../assets/template-previews/product-launch.webp'),
  'square-promo': require('../../../assets/template-previews/square-promo.webp'),
  'story-reel': require('../../../assets/template-previews/story-reel.webp'),
  'web-app-promo': require('../../../assets/template-previews/web-app-promo.webp'),
};
